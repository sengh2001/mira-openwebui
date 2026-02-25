import { writable } from 'svelte/store';
import { PipecatClient as SDKClient, RTVIEvent } from '@pipecat-ai/client-js';
import { WebSocketTransport, TextFrameSerializer, WavMediaManager } from '@pipecat-ai/websocket-transport';

// ── Debug Logging ────────────────────────────────────────────────────
// All verbose diagnostic logs are gated behind a localStorage flag.
// Enable at runtime:  localStorage.setItem('PIPECAT_DEBUG', 'true')
// Disable:            localStorage.removeItem('PIPECAT_DEBUG')
//
// Errors and warnings that indicate real problems are always logged
// via console.warn (console.error is stripped by esbuild in production).
// ─────────────────────────────────────────────────────────────────────
function isPipecatDebug(): boolean {
    try { return localStorage.getItem('PIPECAT_DEBUG') === 'true'; } catch { return false; }
}
/** Conditional logger — only emits when PIPECAT_DEBUG is enabled */
const dbg = (...args: any[]) => { if (isPipecatDebug()) console.warn(...args); };

export class PipecatClient {
    public connected = writable(false);
    public speaking = writable(false);
    public listening = writable(false);
    public error = writable<string | null>(null);

    // --- Classroom config ---
    // When set, the WS config message will include room_id and speaker_id
    // so the server attaches a ClassroomBroadcaster to the pipeline.
    public classroomConfig: { room_id: string; speaker_id: string } | null = null;

    // --- Text streaming stores ---
    // These are populated by intercepting WebSocket messages from the backend.
    // The backend sends JSON `bot_text` chunks alongside binary audio on the same WS.
    public userTranscript = writable<{ text: string }>({ text: '' });
    public botTranscript = writable<{ text: string }>({ text: '' });
    public thinking = writable(false);
    public botResponseComplete = writable(0);  // timestamp trigger for chat injection
    public botResponseInterrupted = writable(0);  // timestamp trigger when response was interrupted by barge-in
    public reconnecting = writable(false);
    public currentBotText = '';
    public sessionId = writable<string | null>(null);

    private pcClient: SDKClient | null = null;
    private botAudio: HTMLAudioElement;
    private _pipecatUrl: string = 'http://localhost:7860';

    constructor() {
        // Set up WebSocket interception to send config on connection
        this.setupWebSocketInterception();

        this.botAudio = new Audio();
        this.botAudio.autoplay = true;

        dbg('[Pipecat] Initializing PipecatClient');
    }

    /**
     * Intercept WebSocket creation to automatically send config message on connection
     * AND to intercept incoming messages for text streaming.
     *
     * Uses GLOBAL mutable state so that:
     *  - The window.WebSocket patch is applied only ONCE (subsequent PipecatClient
     *    instances reuse it).
     *  - `__pipecatActiveClient` always points to the latest PipecatClient, so
     *    WebSocket messages route to the correct instance even after disconnect/reconnect.
     *  - `__pipecatConfigSent` / `__pipecatTextListenerAttached` are reset each time
     *    a new PipecatClient is constructed, allowing fresh connections to send config
     *    and attach text listeners.
     */
    private setupWebSocketInterception(): void {
        // Always update the global reference so the interceptor uses *this* client
        (window as any).__pipecatActiveClient = this;
        // Reset per-connection flags so the next WS connect sends config & attaches listener
        (window as any).__pipecatConfigSent = false;
        (window as any).__pipecatTextListenerAttached = false;

        // Only patch window.WebSocket ONCE
        if ((window as any).__pipecatWsIntercepted) {
            dbg('[Pipecat-WS] WebSocket already intercepted, reusing patch');
            return;
        }
        (window as any).__pipecatWsIntercepted = true;

        const OriginalWebSocket = (window as any).WebSocket;

        (window as any).WebSocket = function (url: string, protocols?: string | string[]) {
            const ws = new OriginalWebSocket(url, protocols);

            // Send config as the very first thing when socket opens
            ws.addEventListener('open', function () {
                if (!(window as any).__pipecatConfigSent && url.includes('/ws')) {
                    (window as any).__pipecatConfigSent = true;
                    const client = (window as any).__pipecatActiveClient;
                    const configMsg: any = { type: "config" };
                    // Include JWT token for auth
                    try {
                        const jwt = typeof localStorage !== 'undefined' && localStorage.getItem('token');
                        if (jwt) configMsg.token = jwt;
                    } catch (_) { /* SSR guard */ }
                    // Include classroom metadata if this is a classroom speaker session
                    if (client?.classroomConfig) {
                        configMsg.room_id = client.classroomConfig.room_id;
                        configMsg.speaker_id = client.classroomConfig.speaker_id;
                        dbg('[Pipecat-WS] Classroom speaker config:', configMsg.room_id, configMsg.speaker_id);
                    }
                    ws.send(JSON.stringify(configMsg));
                    dbg('[Pipecat-WS] Sent config message to server, binaryType =', ws.binaryType);
                }
            }, { once: true });

            // --- MESSAGE INTERCEPTION ---
            // Attach text listener only once per connection cycle
            if (url.includes('/ws') && !(window as any).__pipecatTextListenerAttached) {
                (window as any).__pipecatTextListenerAttached = true;
                let msgCount = 0;

                ws.addEventListener('message', function (event: MessageEvent) {
                    msgCount++;
                    const client = (window as any).__pipecatActiveClient;

                    // Verbose per-message logging (only in debug mode)
                    if (isPipecatDebug() && (msgCount <= 30 || msgCount % 100 === 0)) {
                        const dataType = typeof event.data === 'string' ? 'STRING'
                            : event.data instanceof ArrayBuffer ? 'ARRAYBUFFER'
                                : event.data instanceof Blob ? 'BLOB'
                                    : 'UNKNOWN';
                        const dataSize = typeof event.data === 'string' ? event.data.length
                            : event.data instanceof ArrayBuffer ? event.data.byteLength
                                : event.data instanceof Blob ? event.data.size : 0;
                        dbg(`[WS-INTERCEPT] #${msgCount} ${dataType} size=${dataSize} client=${!!client}`);
                    }

                    if (!client) return;

                    // Helper to process parsed JSON messages
                    const handleJsonMsg = (msg: any) => {
                        dbg(`[WS-INTERCEPT] handleJsonMsg: type=${msg.type} text="${(msg.text || '').substring(0, 40)}"`);
                        if (msg.type === 'session_id' && msg.session_id) {
                            client.sessionId.set(msg.session_id);
                            dbg(`[WS-INTERCEPT] Captured session_id: ${msg.session_id}`);
                        } else if (msg.type === 'bot_text' && msg.text) {
                            client.currentBotText += msg.text;
                            client.botTranscript.set({ text: client.currentBotText });
                        } else if (msg.type === 'bot_text_complete') {
                            if (msg.interrupted) {
                                // Barge-in: finalize partial text, signal interruption,
                                // and reset so the next response starts a fresh message block.
                                client.currentBotText = msg.text || '';
                                client.botTranscript.set({ text: client.currentBotText });
                                client.botResponseInterrupted.set(Date.now());
                                client.currentBotText = '';
                                dbg(`[WS-INTERCEPT] botTranscript INTERRUPTED: "${(msg.text || '').substring(0, 60)}"`);
                            } else {
                                // Normal completion
                                client.currentBotText = msg.text || '';
                                client.botTranscript.set({ text: client.currentBotText });
                                client.botResponseComplete.set(Date.now());
                                client.currentBotText = '';
                                dbg(`[WS-INTERCEPT] botTranscript COMPLETE: "${(msg.text || '').substring(0, 60)}"`);
                            }
                        } else if (msg.type === 'user_transcript' && msg.text) {
                            client.userTranscript.set({ text: msg.text, final: msg.final ?? true });
                            dbg(`[WS-INTERCEPT] userTranscript: "${msg.text.substring(0, 60)}" final=${msg.final}`);
                        }
                    };

                    if (typeof event.data === 'string') {
                        let parsedMsg: any = null;
                        try {
                            parsedMsg = JSON.parse(event.data);
                            dbg('[Pipecat-WS] JSON message:', parsedMsg.type, parsedMsg.text?.substring(0, 60) ?? '');
                        } catch {
                            dbg(`[Pipecat-WS] Non-JSON string: ${event.data.substring(0, 60)}`);
                        }
                        if (parsedMsg) {
                            try {
                                handleJsonMsg(parsedMsg);
                            } catch (e) {
                                console.warn('[WS-INTERCEPT] handleJsonMsg error:', e);
                            }
                        }
                    } else if (event.data instanceof ArrayBuffer) {
                        // Check if JSON was delivered as ArrayBuffer (binaryType="arraybuffer")
                        const bytes = new Uint8Array(event.data);
                        if (bytes.length > 0 && (bytes[0] === 0x7B || bytes[0] === 0x5B)) {
                            const decoded = new TextDecoder().decode(event.data);
                            try {
                                const msg = JSON.parse(decoded);
                                dbg('[Pipecat-WS] JSON arrived as ArrayBuffer:', msg.type);
                                handleJsonMsg(msg);
                            } catch {
                                // Not JSON after all
                            }
                        }
                    } else if (event.data instanceof Blob) {
                        // Blob messages — check if JSON (some transports deliver text as Blob)
                        if (event.data.size < 2000) {
                            event.data.text().then((text: string) => {
                                if (text.startsWith('{')) {
                                    try {
                                        const msg = JSON.parse(text);
                                        dbg('[Pipecat-WS] JSON from Blob:', msg.type);
                                        handleJsonMsg(msg);
                                    } catch { /* not JSON */ }
                                }
                            }).catch(() => { });
                        }
                    }
                });
            }

            return ws;
        } as any;

        // Preserve WebSocket prototype and constants
        (window as any).WebSocket.prototype = OriginalWebSocket.prototype;
        (window as any).WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
        (window as any).WebSocket.OPEN = OriginalWebSocket.OPEN;
        (window as any).WebSocket.CLOSING = OriginalWebSocket.CLOSING;
        (window as any).WebSocket.CLOSED = OriginalWebSocket.CLOSED;
    }

    /**
     * Set up audio track for playback
     */
    private setupAudioTrack(track: MediaStreamTrack): void {
        dbg('[Pipecat] Setting up bot audio track');

        // Check if we already have this track
        if (this.botAudio.srcObject && 'getAudioTracks' in this.botAudio.srcObject) {
            const oldTrack = this.botAudio.srcObject.getAudioTracks()[0];
            if (oldTrack?.id === track.id) return;
        }

        this.botAudio.srcObject = new MediaStream([track]);
        this.speaking.set(true);
    }

    /**
     * Set up track listeners
     */
    private setupTrackListeners(): void {
        if (!this.pcClient) return;

        this.pcClient.on(RTVIEvent.TrackStarted, (track: MediaStreamTrack, participant: any) => {
            dbg('[Pipecat] Track started:', track.kind, participant);

            // Only handle bot (non-local) audio tracks
            if (!participant?.local && track.kind === 'audio') {
                this.setupAudioTrack(track);
            }
        });

        this.pcClient.on(RTVIEvent.TrackStopped, (track: MediaStreamTrack, participant: any) => {
            dbg('[Pipecat] Track stopped:', track.kind);
            this.speaking.set(false);
        });
    }

    /**
     * Check for existing tracks after bot is ready
     */
    private setupMediaTracks(): void {
        if (!this.pcClient) return;

        const tracks = this.pcClient.tracks();
        if (tracks.bot?.audio) {
            this.setupAudioTrack(tracks.bot.audio);
        }
    }

    async connect(
        url: string = 'http://localhost:7860',
        mode: 'webrtc' | 'websocket' = 'websocket',
        initialConfig: any = null
    ) {
        try {
            this.error.set(null);
            // Reset text state on new connection
            this.currentBotText = '';
            this.botTranscript.set({ text: '' });
            this.userTranscript.set({ text: '' });
            this.thinking.set(false);
            this.sessionId.set(null);
            this._pipecatUrl = url;

            dbg('[Pipecat] Connecting to:', url);

            // Convert to WebSocket URL
            let wsUrl = url;
            if (wsUrl.startsWith('http://')) wsUrl = wsUrl.replace('http://', 'ws://');
            else if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');
            if (!wsUrl.endsWith('/ws')) wsUrl = `${wsUrl}/ws`;

            // Use official Pipecat example pattern with Protobuf serialization
            // Server expects Protobuf-encoded frames for audio processing
            this.pcClient = new SDKClient({
                transport: new WebSocketTransport({
                    serializer: new ProtobufFrameSerializer(),
                    // @ts-ignore - implementation has 3 args but types only show 2
                    mediaManager: new WavMediaManager(512, 16000, 24000),
                    recorderSampleRate: 16000,
                    playerSampleRate: 24000
                }),
                enableMic: true,
                enableCam: false,
                callbacks: {
                    onConnected: () => {
                        dbg('[Pipecat] Connected');
                        this.connected.set(true);
                    },
                    onDisconnected: () => {
                        dbg('[Pipecat] Disconnected');
                        this.connected.set(false);
                        this.listening.set(false);
                        this.speaking.set(false);
                    },
                    onBotReady: (data: any) => {
                        dbg('[Pipecat] Bot ready', data);
                        this.setupMediaTracks();
                    },
                    onDeviceError: (error: any) => {
                        console.warn('[Pipecat] Transport error:', error);
                        this.error.set(`Transport error: ${error}`);
                    },
                    onMessage: (message: any) => {
                        dbg('[Pipecat] Internal SDK message:', message);
                    },
                    onUserTranscript: (data: any) => {
                        dbg('[Pipecat] User transcript:', data.text, 'final:', data.final);
                        if (data.final) {
                            this.userTranscript.set({ text: data.text, final: true });
                        }
                    },
                    onUserStartedSpeaking: () => {
                        dbg('[Pipecat] User STARTED speaking');
                        // Reset bot text for new turn
                        this.currentBotText = '';
                        this.botTranscript.set({ text: '' });
                        this.thinking.set(true);
                    },
                    onUserStoppedSpeaking: () => {
                        dbg('[Pipecat] User STOPPED speaking');
                    },
                    onBotTranscript: (data: any) => {
                        dbg('[Pipecat] Bot transcript (TTS):', data.text);
                    },
                    onBotLlmText: (data: any) => {
                        dbg('[Pipecat] Bot LLM text:', data.text);
                        // NOTE: Text accumulation is handled by the WebSocket interceptor
                        // (bot_text / bot_text_complete JSON messages). Do NOT accumulate here
                        // to avoid double text.
                    },
                    onTrackStarted: (track: MediaStreamTrack, participant?: any) => {
                        dbg('[Pipecat] Track started:', track.kind, participant?.local ? 'local' : 'remote');

                        if (track.kind === 'audio') {
                            if (participant?.local) {
                                this.listening.set(true);
                            } else {
                                this.speaking.set(true);
                                this.setupAudioTrack(track);
                            }
                        }
                    },
                    onTrackStopped: (track: MediaStreamTrack, participant?: any) => {
                        dbg('[Pipecat] Track stopped:', track.kind, participant?.local ? 'local' : 'remote');
                        if (track.kind === 'audio') {
                            if (participant?.local) this.listening.set(false);
                            else this.speaking.set(false);
                        }
                    },
                    onTransportStateChanged: (state: any) => {
                        dbg('[Pipecat] Transport state:', state);
                    },
                    onBotStarted: (botResponse: any) => {
                        dbg('[Pipecat] Bot STARTED:', botResponse);
                    },
                    onBotConnected: (participant: any) => {
                        dbg('[Pipecat] Bot CONNECTED:', participant);
                    },
                    onError: (error: any) => {
                        console.warn('[Pipecat] Error:', error);
                        this.error.set(error?.message || 'Connection error');
                    },
                },
            });

            // Set up track listeners
            this.setupTrackListeners();

            // Diagnostics
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Browser does not support mediaDevices.getUserMedia. Are you on HTTP? Use HTTPS or localhost.');
            }

            // --- Hardware Initialization ---
            try {
                await this.pcClient.initDevices();
                dbg('[Pipecat] Devices initialized');
            } catch (initErr) {
                console.warn('[Pipecat] initDevices failed:', initErr);
                throw initErr;
            }

            // --- Pre-flight Check ---
            // 1006 errors are often caused by certificate issues (untrusted CA or hostname mismatch).
            const healthUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://').replace('/ws', '/health');
            dbg('[Pipecat] Pre-flight check:', healthUrl);

            try {
                const prefHdrs: Record<string, string> = {};
                try {
                    const jwt = typeof localStorage !== 'undefined' && localStorage.getItem('token');
                    if (jwt) prefHdrs['Authorization'] = `Bearer ${jwt}`;
                } catch (_) { /* SSR guard */ }
                const response = await fetch(healthUrl, { mode: 'cors', headers: prefHdrs });
                if (!response.ok) {
                    throw new Error(`Server health check failed with status: ${response.status}`);
                }
                dbg('[Pipecat] Pre-flight check success');
            } catch (fetchErr: any) {
                console.warn('[Pipecat] Pre-flight check failed (possible certificate/network issue):', fetchErr.message);

                if (wsUrl.startsWith('wss://')) {
                    const baseUrl = wsUrl.replace('wss://', 'https://').split('/ws')[0];
                    const msg = `SSL/TLS Error: Please open ${baseUrl}/health in a new tab, "Accept the Risk", then try again.`;
                    this.error.set(msg);
                    throw new Error('SSL_CERT_ERROR');
                }
            }

            // Connect with wsUrl (official Pipecat pattern)
            dbg('[Pipecat] Connecting to bot...');
            await this.pcClient.connect({ wsUrl });
            dbg('[Pipecat] Connection complete');

            // Debug: Log all tracks after connection
            if (isPipecatDebug()) {
                const tracks = this.pcClient.tracks();
                dbg('[Pipecat] Tracks after connection:', {
                    localAudio: tracks.local?.audio ? 'YES' : 'NO',
                    botAudio: tracks.bot?.audio ? 'YES' : 'NO'
                });
                dbg('[Pipecat] Mic enabled:', this.pcClient.isMicEnabled);
            }
        } catch (err: any) {
            if (err.message === 'SSL_CERT_ERROR') return; // error already set

            console.warn('[Pipecat] Connection error:', err.message || err);

            // Helpful message for the notorious 1006 error
            let userMsg = err.message || 'Failed to connect';
            if (err.toString().includes('1006')) {
                userMsg = 'Connection closed (1006). This usually means a certificate mismatch or the server crashed.';
            }

            this.error.set(userMsg);
            this.disconnect();
        }
    }

    sendMessage(message: any) {
        // Not implemented for voice mode
    }

    /**
     * Send typed text into the active voice pipeline.
     * The text is injected as a TranscriptionFrame on the server,
     * processed by the LLM, and spoken back via TTS.
     *
     * Returns true if successfully sent, false otherwise.
     */
    async sendText(text: string): Promise<boolean> {
        let sid: string | null = null;
        this.sessionId.subscribe(v => sid = v)();

        if (!sid) {
            console.warn('[Pipecat] sendText: no session_id yet');
            return false;
        }

        const url = `${this._pipecatUrl}/inject_text`;
        dbg(`[Pipecat] sendText: injecting text via ${url}, session=${sid}, text="${text.substring(0, 60)}"`);

        try {
            const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
            try {
                const jwt = typeof localStorage !== 'undefined' && localStorage.getItem('token');
                if (jwt) hdrs['Authorization'] = `Bearer ${jwt}`;
            } catch (_) { /* SSR guard */ }
            const res = await fetch(url, {
                method: 'POST',
                headers: hdrs,
                body: JSON.stringify({ session_id: sid, text }),
            });

            if (!res.ok) {
                const errText = await res.text();
                console.warn(`[Pipecat] sendText failed: ${res.status} ${errText}`);
                return false;
            }

            dbg('[Pipecat] sendText: success');
            return true;
        } catch (err: any) {
            console.warn('[Pipecat] sendText error:', err.message || err);
            return false;
        }
    }

    disconnect() {
        dbg('[Pipecat] Disconnecting...');

        if (this.pcClient) {
            this.pcClient.disconnect().catch(err => {
                dbg('[Pipecat] Disconnect warning:', err.message);
            });
            this.pcClient = null;
        }

        // Clean up bot audio
        if (this.botAudio.srcObject && 'getAudioTracks' in this.botAudio.srcObject) {
            this.botAudio.srcObject.getAudioTracks().forEach(track => track.stop());
            this.botAudio.srcObject = null;
        }

        this.connected.set(false);
        this.listening.set(false);
        this.speaking.set(false);
        this.sessionId.set(null);
    }
}
