<script lang="ts">
	import { config, models, settings, showCallOverlay, TTSWorker, user } from '$lib/stores';
	import { onMount, tick, getContext, onDestroy, createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	import { blobToFile } from '$lib/utils';
	import { generateEmoji } from '$lib/apis';
	import { synthesizeOpenAISpeech, transcribeAudio } from '$lib/apis/audio';
	import { getChatById } from '$lib/apis/chats';

	import { toast } from 'svelte-sonner';

	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import VideoInputMenu from './CallOverlay/VideoInputMenu.svelte';
	import { KokoroWorker } from '$lib/workers/KokoroWorker';
	import { PipecatClient } from '$lib/services/pipecat';
	import { WEBUI_API_BASE_URL } from '$lib/constants';

	const i18n = getContext('i18n');

	import { v4 as uuidv4 } from 'uuid';

	// ── Debug Logging ──
	// Enable: localStorage.setItem('PIPECAT_DEBUG', 'true')
	// Disable: localStorage.removeItem('PIPECAT_DEBUG')
	function isPipecatDebug(): boolean {
		try { return localStorage.getItem('PIPECAT_DEBUG') === 'true'; } catch { return false; }
	}
	const dbg = (...args: any[]) => { if (isPipecatDebug()) console.warn(...args); };

	const getTestHooks = () => {
		try {
			// @ts-expect-error - test-only hook
			if (typeof window === 'undefined') return null;
			// @ts-expect-error - test-only hook
			window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
			// @ts-expect-error - test-only hook
			return window.__TEST_HOOKS__;
		} catch {
			return null;
		}
	};

	export let eventTarget: EventTarget;
	export let submitPrompt: Function;
	export let stopResponse: Function;
	export let files;
	export let chatId;
	export let modelId;
	export let history = { messages: {}, currentId: null };

	let wakeLock = null;

	let model = null;

	let loading = false;
	let confirmed = false;
	let interrupted = false;
	let assistantSpeaking = false;

	let emoji = null;
	let camera = false;
	let cameraStream = null;

	// Pipecat
	let pipecatClient = null;
	let pipecatConnected = false;
	let pipecatThinking = false;
	let pipecatReconnecting = false;
	let thinkingUnsub = null;
	let reconnectingUnsub = null;

	/**
	 * Send typed text into the active voice pipeline.
	 * Called by Chat.svelte when the user types text while voice mode is active.
	 * Returns true if sent successfully, false otherwise (e.g. not connected).
	 */
	export async function sendTextToVoice(text: string): Promise<boolean> {
		if (!pipecatClient || !pipecatConnected) {
			console.warn('[CallOverlay] sendTextToVoice: not connected, falling back to text mode');
			return false;
		}
		return await pipecatClient.sendText(text);
	}

	// Track Pipecat voice conversation in chat history
	let pipecatUserMsgId = null;
	let pipecatBotMsgId = null;
	let userTranscriptUnsub = null;
	let botTranscriptUnsub = null;
	let botInterruptedUnsub = null;

	// Live transcript messages shown in the overlay during voice call
	let liveBotText = '';
	let liveUserText = '';
	let liveMessages: Array<{ role: 'user' | 'assistant'; text: string }> = [];
	let transcriptContainer: HTMLElement;

	let chatStreaming = false;
	let rmsLevel = 0;
	let hasStartedSpeaking = false;
	let mediaRecorder;
	let audioStream = null;
	let audioChunks = [];

	// ── UX State Timing Instrumentation ──────────────────────────────
	// Tracks visual state transitions so we can measure what the user
	// actually *sees* and correlate with backend pipeline timing.
	// Filter browser console with "[UX-METRICS]" to see only these logs.

	let _uxOverlayOpenedAt = 0;        // When CallOverlay mounted
	let _uxLoadingStartAt = 0;         // When "Connecting..." shown
	let _uxListeningStartAt = 0;       // When "Listening..." shown
	let _uxSpeakingStartAt = 0;        // When "Speaking" waveform shown
	let _uxPrevState = 'init';         // Previous visual state
	let _uxStateTransitions: Array<{ from: string; to: string; at: number; durationMs: number }> = [];

	function _uxLogStateChange(newState: string): void {
		const now = performance.now();
		const prev = _uxPrevState;
		let durationMs = 0;

		if (prev === 'loading' && _uxLoadingStartAt > 0) {
			durationMs = now - _uxLoadingStartAt;
		} else if (prev === 'listening' && _uxListeningStartAt > 0) {
			durationMs = now - _uxListeningStartAt;
		} else if (prev === 'speaking' && _uxSpeakingStartAt > 0) {
			durationMs = now - _uxSpeakingStartAt;
		} else if (prev === 'init' && _uxOverlayOpenedAt > 0) {
			durationMs = now - _uxOverlayOpenedAt;
		}

		_uxStateTransitions.push({ from: prev, to: newState, at: now, durationMs });

		dbg(`[UX-METRICS] STATE: ${prev} → ${newState}  (${prev} lasted ${durationMs.toFixed(0)}ms)`);

		// Update timestamps for the new state
		if (newState === 'loading') _uxLoadingStartAt = now;
		else if (newState === 'listening') _uxListeningStartAt = now;
		else if (newState === 'speaking') _uxSpeakingStartAt = now;

		_uxPrevState = newState;
	}

	function _uxLogSummary(): void {
		if (_uxStateTransitions.length === 0) return;
		const totalMs = performance.now() - _uxOverlayOpenedAt;

		// Accumulate time per state
		const stateTimes: Record<string, number> = {};
		for (const t of _uxStateTransitions) {
			stateTimes[t.from] = (stateTimes[t.from] || 0) + t.durationMs;
		}

		dbg(`[UX-METRICS] ═══ OVERLAY SESSION SUMMARY ═══`);
		dbg(`[UX-METRICS]   Total overlay time:  ${(totalMs / 1000).toFixed(1)}s`);
		dbg(`[UX-METRICS]   State transitions:   ${_uxStateTransitions.length}`);
		for (const [state, ms] of Object.entries(stateTimes)) {
			const pct = ((ms / totalMs) * 100).toFixed(1);
			dbg(`[UX-METRICS]   Time in '${state}':  ${(ms / 1000).toFixed(1)}s  (${pct}%)`);
		}
		const firstListening = _uxStateTransitions.find(t => t.to === 'listening');
		if (firstListening) {
			const firstListenMs = firstListening.at - _uxOverlayOpenedAt;
			dbg(`[UX-METRICS]   ★ Open→Listening:    ${firstListenMs.toFixed(0)}ms  (user waits this long)`);
		}
		dbg(`[UX-METRICS] ═══════════════════════════`);
	}

	// Reactive: track visual state changes driven by `loading`, `pipecatThinking`, `pipecatReconnecting`, and `assistantSpeaking`
	$: {
		const currentVisualState = loading ? 'loading'
			: pipecatReconnecting ? 'reconnecting'
			: pipecatThinking ? 'thinking'
			: assistantSpeaking ? 'speaking'
			: 'listening';
		if (currentVisualState !== _uxPrevState && _uxOverlayOpenedAt > 0) {
			_uxLogStateChange(currentVisualState);
		}
	}

	let videoInputDevices = [];
	let selectedVideoInputDeviceId = null;

	const getVideoInputDevices = async () => {
		const devices = await navigator.mediaDevices.enumerateDevices();
		videoInputDevices = devices.filter((device) => device.kind === 'videoinput');

		if (!!navigator.mediaDevices.getDisplayMedia) {
			videoInputDevices = [
				...videoInputDevices,
				{
					deviceId: 'screen',
					label: 'Screen Share'
				}
			];
		}

		dbg('[CallOverlay] videoInputDevices:', videoInputDevices);
		if (selectedVideoInputDeviceId === null && videoInputDevices.length > 0) {
			selectedVideoInputDeviceId = videoInputDevices[0].deviceId;
		}
	};

	const startCamera = async () => {
		await getVideoInputDevices();

		if (cameraStream === null) {
			camera = true;
			await tick();
			try {
				await startVideoStream();
			} catch (err) {
				console.warn('[CallOverlay] Error accessing webcam:', err);
			}
		}
	};

	const startVideoStream = async () => {
		const video = document.getElementById('camera-feed');
		if (video) {
			if (selectedVideoInputDeviceId === 'screen') {
				cameraStream = await navigator.mediaDevices.getDisplayMedia({
					video: {
						cursor: 'always'
					},
					audio: false
				});
			} else {
				cameraStream = await navigator.mediaDevices.getUserMedia({
					video: {
						deviceId: selectedVideoInputDeviceId ? { exact: selectedVideoInputDeviceId } : undefined
					}
				});
			}

			if (cameraStream) {
				await getVideoInputDevices();
				video.srcObject = cameraStream;
				await video.play();
			}
		}
	};

	const stopVideoStream = async () => {
		if (cameraStream) {
			const tracks = cameraStream.getTracks();
			tracks.forEach((track) => track.stop());
		}

		cameraStream = null;
	};

	const takeScreenshot = () => {
		const video = document.getElementById('camera-feed');
		const canvas = document.getElementById('camera-canvas');

		if (!canvas) {
			return;
		}

		const context = canvas.getContext('2d');

		// Make the canvas match the video dimensions
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;

		// Draw the image from the video onto the canvas
		context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

		// Convert the canvas to a data base64 URL and console log it
		const dataURL = canvas.toDataURL('image/png');
		dbg('[CallOverlay] Screenshot taken');

		return dataURL;
	};

	const stopCamera = async () => {
		await stopVideoStream();
		camera = false;
	};

	const MIN_DECIBELS = -55;
	const VISUALIZER_BUFFER_LENGTH = 300;

	const transcribeHandler = async (audioBlob) => {
		// Create a blob from the audio chunks

		await tick();
		const file = blobToFile(audioBlob, 'recording.wav');

		const res = await transcribeAudio(
			localStorage.token,
			file,
			$settings?.audio?.stt?.language
		).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (res) {
			dbg('[CallOverlay] Transcription result:', res.text);

			if (res.text !== '') {
				const _responses = await submitPrompt(res.text, { _raw: true });
				dbg('[CallOverlay] Prompt responses:', _responses);
			}
		}
	};

	const stopRecordingCallback = async (_continue = true) => {
		if ($showCallOverlay) {
			dbg('[CallOverlay] stopRecordingCallback');

			// deep copy the audioChunks array
			const _audioChunks = audioChunks.slice(0);

			audioChunks = [];
			mediaRecorder = false;

			if (_continue) {
				startRecording();
			}

			if (confirmed) {
				loading = true;
				emoji = null;

				if (cameraStream) {
					const imageUrl = takeScreenshot();

					files = [
						{
							type: 'image',
							url: imageUrl
						}
					];
				}

				const audioBlob = new Blob(_audioChunks, { type: 'audio/wav' });
				await transcribeHandler(audioBlob);

				confirmed = false;
				loading = false;
			}
		} else {
			audioChunks = [];
			mediaRecorder = false;

			if (audioStream) {
				const tracks = audioStream.getTracks();
				tracks.forEach((track) => track.stop());
			}
			audioStream = null;
		}
	};

	const startRecording = async () => {
		if ($showCallOverlay) {
			if (!audioStream) {
				audioStream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true
					}
				});
			}
			mediaRecorder = new MediaRecorder(audioStream);

			mediaRecorder.onstart = () => {
				dbg('[CallOverlay] Recording started');
				audioChunks = [];
			};

			mediaRecorder.ondataavailable = (event) => {
				if (hasStartedSpeaking) {
					audioChunks.push(event.data);
				}
			};

			mediaRecorder.onstop = (e) => {
				dbg('[CallOverlay] Recording stopped');
				stopRecordingCallback();
			};

			analyseAudio(audioStream);
		}
	};

	const stopAudioStream = async () => {
		try {
			if (mediaRecorder) {
				mediaRecorder.stop();
			}
		} catch (error) {
			dbg('[CallOverlay] Error stopping audio stream:', error);
		}

		if (!audioStream) return;

		audioStream.getAudioTracks().forEach(function (track) {
			track.stop();
		});

		audioStream = null;
	};

	// Function to calculate the RMS level from time domain data
	const calculateRMS = (data: Uint8Array) => {
		let sumSquares = 0;
		for (let i = 0; i < data.length; i++) {
			const normalizedValue = (data[i] - 128) / 128; // Normalize the data
			sumSquares += normalizedValue * normalizedValue;
		}
		return Math.sqrt(sumSquares / data.length);
	};

	const analyseAudio = (stream) => {
		const audioContext = new AudioContext();
		const audioStreamSource = audioContext.createMediaStreamSource(stream);

		const analyser = audioContext.createAnalyser();
		analyser.minDecibels = MIN_DECIBELS;
		audioStreamSource.connect(analyser);

		const bufferLength = analyser.frequencyBinCount;

		const domainData = new Uint8Array(bufferLength);
		const timeDomainData = new Uint8Array(analyser.fftSize);

		let lastSoundTime = Date.now();
		hasStartedSpeaking = false;

		dbg('[CallOverlay] Sound detection started');

		const detectSound = () => {
			const processFrame = () => {
				if (!mediaRecorder || !$showCallOverlay) {
					return;
				}

				if (assistantSpeaking && !($settings?.voiceInterruption ?? false)) {
					// Mute the audio if the assistant is speaking
					analyser.maxDecibels = 0;
					analyser.minDecibels = -1;
				} else {
					analyser.minDecibels = MIN_DECIBELS;
					analyser.maxDecibels = -30;
				}

				analyser.getByteTimeDomainData(timeDomainData);
				analyser.getByteFrequencyData(domainData);

				// Calculate RMS level from time domain data
				rmsLevel = calculateRMS(timeDomainData);

				// Check if initial speech/noise has started
				const hasSound = domainData.some((value) => value > 0);
				if (hasSound) {
					// BIG RED TEXT
					dbg('[CallOverlay] Sound detected');
					if (mediaRecorder && mediaRecorder.state !== 'recording') {
						mediaRecorder.start();
					}

					if (!hasStartedSpeaking) {
						hasStartedSpeaking = true;
						stopAllAudio();
					}

					lastSoundTime = Date.now();
				}

				// Start silence detection only after initial speech/noise has been detected
				if (hasStartedSpeaking) {
					if (Date.now() - lastSoundTime > 2000) {
						confirmed = true;

						if (mediaRecorder) {
							dbg('[CallOverlay] Silence detected');
							mediaRecorder.stop();
							return;
						}
					}
				}

				window.requestAnimationFrame(processFrame);
			};

			window.requestAnimationFrame(processFrame);
		};

		detectSound();
	};

	let finishedMessages = {};
	let currentMessageId = null;
	let currentUtterance = null;

	// Get voice: model-specific > user settings > config default
	const getVoiceId = () => {
		// Check for model-specific TTS voice first
		if (model?.info?.meta?.tts?.voice) {
			return model.info.meta.tts.voice;
		}
		// Fall back to user settings or config default
		if ($settings?.audio?.tts?.defaultVoice === $config.audio.tts.voice) {
			return $settings?.audio?.tts?.voice ?? $config?.audio?.tts?.voice;
		}
		return $config?.audio?.tts?.voice;
	};

	const speakSpeechSynthesisHandler = (content) => {
		if ($showCallOverlay) {
			return new Promise((resolve) => {
				let voices = [];
				const getVoicesLoop = setInterval(async () => {
					voices = await speechSynthesis.getVoices();
					if (voices.length > 0) {
						clearInterval(getVoicesLoop);

						const voiceId = getVoiceId();
						const voice = voices?.filter((v) => v.voiceURI === voiceId)?.at(0) ?? undefined;

						currentUtterance = new SpeechSynthesisUtterance(content);
						currentUtterance.rate = $settings.audio?.tts?.playbackRate ?? 1;

						if (voice) {
							currentUtterance.voice = voice;
						}

						speechSynthesis.speak(currentUtterance);
						currentUtterance.onend = async (e) => {
							await new Promise((r) => setTimeout(r, 200));
							resolve(e);
						};
					}
				}, 100);
			});
		} else {
			return Promise.resolve();
		}
	};

	const playAudio = (audio) => {
		if ($showCallOverlay) {
			return new Promise((resolve) => {
				const testHooks = getTestHooks();
				if (testHooks) {
					testHooks.audioPlayCount = (testHooks.audioPlayCount || 0) + 1;
				}
				const audioElement = document.getElementById('audioElement') as HTMLAudioElement;

				if (audioElement) {
					audioElement.src = audio.src;
					audioElement.muted = true;
					audioElement.playbackRate = $settings.audio?.tts?.playbackRate ?? 1;

					audioElement
						.play()
						.then(() => {
							audioElement.muted = false;
						})
						.catch((error) => {
							console.warn('[CallOverlay] Audio play error:', error);
						});

					audioElement.onended = async (e) => {
						await new Promise((r) => setTimeout(r, 100));
						resolve(e);
					};
				}
			});
		} else {
			return Promise.resolve();
		}
	};

	const stopAllAudio = async () => {
		assistantSpeaking = false;
		interrupted = true;

		if (chatStreaming) {
			stopResponse();
		}

		if (currentUtterance) {
			speechSynthesis.cancel();
			currentUtterance = null;
		}

		const audioElement = document.getElementById('audioElement');
		if (audioElement) {
			audioElement.muted = true;
			audioElement.pause();
			audioElement.currentTime = 0;
		}
	};

	let audioAbortController = new AbortController();

	// Audio cache map where key is the content and value is the Audio object.
	const audioCache = new Map();
	const emojiCache = new Map();

	const fetchAudio = async (content) => {
		if (!audioCache.has(content)) {
			try {
				// Set the emoji for the content if needed
				if ($settings?.showEmojiInCall ?? false) {
					const emoji = await generateEmoji(localStorage.token, modelId, content, chatId);
					if (emoji) {
						emojiCache.set(content, emoji);
					}
				}

				if ($settings.audio?.tts?.engine === 'browser-kokoro') {
					const url = await $TTSWorker
						.generate({
							text: content,
							voice: getVoiceId()
						})
						.catch((error) => {
							console.warn('[CallOverlay] Kokoro TTS error:', error);
							toast.error(`${error}`);
						});

					if (url) {
						audioCache.set(content, new Audio(url));
					}
				} else if ($config.audio.tts.engine !== '') {
					const res = await synthesizeOpenAISpeech(localStorage.token, getVoiceId(), content).catch(
						(error) => {
							console.warn('[CallOverlay] OpenAI TTS error:', error);
							return null;
						}
					);

					if (res) {
						const blob = await res.blob();
						const blobUrl = URL.createObjectURL(blob);
						audioCache.set(content, new Audio(blobUrl));
					}
				} else {
					audioCache.set(content, true);
				}
			} catch (error) {
				console.warn('[CallOverlay] Error synthesizing speech:', error);
			}
		}

		return audioCache.get(content);
	};

	let messages = {};

	const monitorAndPlayAudio = async (id, signal) => {
		while (!signal.aborted) {
			if (messages[id] && messages[id].length > 0) {
				// Retrieve the next content string from the queue
				const content = messages[id].shift(); // Dequeues the content for playing

				if (audioCache.has(content)) {
					// If content is available in the cache, play it

					// Set the emoji for the content if available
					if (($settings?.showEmojiInCall ?? false) && emojiCache.has(content)) {
						emoji = emojiCache.get(content);
					} else {
						emoji = null;
					}

					if ($config.audio.tts.engine !== '') {
						try {
							dbg('[CallOverlay] Playing audio for:', content.substring(0, 60));
							const audio = audioCache.get(content);
							await playAudio(audio);
							dbg('[CallOverlay] Played audio for:', content.substring(0, 60));
							await new Promise((resolve) => setTimeout(resolve, 200));
						} catch (error) {
							console.warn('[CallOverlay] Error playing audio:', error);
						}
					} else {
						await speakSpeechSynthesisHandler(content);
					}
				} else {
					// If not available in the cache, push it back to the queue and delay
					messages[id].unshift(content); // Re-queue the content at the start
					dbg(`[CallOverlay] Audio not cached yet, re-queued: ${content.substring(0, 40)}`);
					await new Promise((resolve) => setTimeout(resolve, 200)); // Wait before retrying to reduce tight loop
				}
			} else if (finishedMessages[id] && messages[id] && messages[id].length === 0) {
				// If the message is finished and there are no more messages to process, break the loop
				assistantSpeaking = false;
				break;
			} else {
				// No messages to process, sleep for a bit
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}
		dbg(`[CallOverlay] Audio monitoring stopped for message ${id}`);
	};

	const chatStartHandler = async (e) => {
		const { id } = e.detail;

		chatStreaming = true;

		if (currentMessageId !== id) {
			dbg(`[CallOverlay] Chat start for message ${id}`);

			currentMessageId = id;
			if (audioAbortController) {
				audioAbortController.abort();
			}
			audioAbortController = new AbortController();

			assistantSpeaking = true;
			// Start monitoring and playing audio for the message ID
			monitorAndPlayAudio(id, audioAbortController.signal);
		}
	};

	const chatEventHandler = async (e) => {
		const { id, content } = e.detail;
		// "id" here is message id
		// if "id" is not the same as "currentMessageId" then do not process
		// "content" here is a sentence from the assistant,
		// there will be many sentences for the same "id"

		if (currentMessageId === id) {
			dbg(`[CallOverlay] Chat event for ${id}:`, content?.substring(0, 60));

			try {
				if (messages[id] === undefined) {
					messages[id] = [content];
				} else {
					messages[id].push(content);
				}

				fetchAudio(content);
			} catch (error) {
				console.warn('[CallOverlay] Failed to fetch or play audio:', error);
			}
		}
	};

	const chatFinishHandler = async (e) => {
		const { id, content } = e.detail;
		// "content" here is the entire message from the assistant
		finishedMessages[id] = true;

		chatStreaming = false;
	};

	onMount(async () => {
		console.warn('[VOICE_DEBUG] CallOverlay onMount fired, showCallOverlay=', $showCallOverlay);
		const testHooks = getTestHooks();
		if (testHooks) {
			testHooks.overlayMounted = true;
			testHooks.audioPlayCount = testHooks.audioPlayCount || 0;
			testHooks.resetAudioPlayCount = () => {
				testHooks.audioPlayCount = 0;
			};
			testHooks.triggerAudioPlayback = async () => {
				const sample = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
				await playAudio(new Audio(sample));
			};
		}

		// ── UX Metrics: mark overlay open time ──
		_uxOverlayOpenedAt = performance.now();
		_uxPrevState = 'init';
		dbg(`[UX-METRICS] OVERLAY_OPENED  t=${_uxOverlayOpenedAt.toFixed(0)}`);

		const setWakeLock = async () => {
			try {
				wakeLock = await navigator.wakeLock.request('screen');
			} catch (err) {
				// The Wake Lock request has failed - usually system related, such as battery.
				dbg('[CallOverlay] Wake lock error:', err);
			}

			if (wakeLock) {
				// Add a listener to release the wake lock when the page is unloaded
				wakeLock.addEventListener('release', () => {
					// the wake lock has been released
					dbg('[CallOverlay] Wake Lock released');
				});
			}
		};

		if ('wakeLock' in navigator) {
			await setWakeLock();

			document.addEventListener('visibilitychange', async () => {
				// Re-request the wake lock if the document becomes visible
				if (wakeLock !== null && document.visibilityState === 'visible') {
					await setWakeLock();
				}
			});
		}

		model = $models.find((m) => m.id === modelId);

		model = $models.find((m) => m.id === modelId);

		if ($config?.audio?.pipecat?.enabled) {
			dbg('[CallOverlay] Pipecat Voice Mode Enabled');
			pipecatClient = new PipecatClient();

			// Subscribe to Pipecat stores — with UX timing instrumentation
			pipecatClient.connected.subscribe(async (val) => {
				const now = performance.now();
				pipecatConnected = val;
				confirmed = val;
				if (val) {
					loading = false;
					const connectUxMs = _uxOverlayOpenedAt > 0 ? now - _uxOverlayOpenedAt : 0;
					dbg(`[UX-METRICS] PIPECAT_CONNECTED  overlay_open→connected=${connectUxMs.toFixed(0)}ms`);
				} else {
					dbg(`[UX-METRICS] PIPECAT_DISCONNECTED`);
				}
			});

			pipecatClient.speaking.subscribe((isSpeaking) => {
				const now = performance.now();
				if (isSpeaking) {
					assistantSpeaking = true;
					dbg(`[UX-METRICS] PIPECAT_SPEAKING=true`);
				} else {
					if (assistantSpeaking) {
						const speakDur = _uxSpeakingStartAt > 0 ? now - _uxSpeakingStartAt : 0;
						dbg(`[UX-METRICS] PIPECAT_SPEAKING=false  (${speakDur.toFixed(0)}ms)`);
					}
					assistantSpeaking = false;
				}
			});

			pipecatClient.listening.subscribe((isListening) => {
				if (isListening) {
					dbg(`[UX-METRICS] PIPECAT_LISTENING=true`);
				}
			});

		pipecatClient.error.subscribe((err) => {
			if (err) {
				dbg(`[UX-METRICS] PIPECAT_ERROR: ${err}`);
				toast.error(`Pipecat Error: ${err}`);
			}
		});

		// ── Day 2A: Subscribe to thinking state ──
		thinkingUnsub = pipecatClient.thinking.subscribe((isThinking) => {
			pipecatThinking = isThinking;
			if (isThinking) {
				dbg(`[UX-METRICS] PIPECAT_THINKING=true`);
				_uxLogStateChange('thinking');
			}
		});

		// ── Day 2B: Subscribe to reconnecting state ──
		reconnectingUnsub = pipecatClient.reconnecting.subscribe((isReconnecting) => {
			pipecatReconnecting = isReconnecting;
			if (isReconnecting) {
				dbg(`[UX-METRICS] PIPECAT_RECONNECTING=true`);
				toast.loading('Reconnecting to MIRA...', { duration: 5000 });
			}
		});

	loading = true; // Show spinner while connecting
	dbg(`[UX-METRICS] LOADING_START  (connecting to Pipecat)`);

	// Subscribe to user transcripts from Pipecat and inject into chat history
	userTranscriptUnsub = pipecatClient.userTranscript.subscribe((data) => {
		if (!data || !data.text) return;

		dbg('[Pipecat-Chat] userTranscript:', data.text.substring(0, 60), 'final:', data.final);

		// Update live overlay with user speech
		liveUserText = data.text;
		if (data.final && data.text.trim()) {
			liveMessages = [...liveMessages, { role: 'user', text: data.text }];
			liveUserText = '';
			tick().then(() => {
				if (transcriptContainer) {
					transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
				}
			});
		}

		if (data.final) {
			// Final user transcript → create user message in history
			const msgId = uuidv4();
				const parentId = history.currentId;

				const userMessage = {
					id: msgId,
					parentId: parentId,
					childrenIds: [],
					role: 'user',
					content: data.text,
					timestamp: Math.floor(Date.now() / 1000),
					models: [modelId].filter(Boolean),
					done: true
				};

				history.messages[msgId] = userMessage;
				if (parentId && history.messages[parentId]) {
					history.messages[parentId].childrenIds = [
						...(history.messages[parentId].childrenIds || []),
						msgId
					];
				}
				history.currentId = msgId;
				pipecatUserMsgId = msgId;

				// Reset bot message ID for the next bot response
				pipecatBotMsgId = null;

				// Trigger Svelte reactivity — spread creates a new object reference
				history = { ...history };

				dbg('[Pipecat-Chat] Added user message to history:', data.text.substring(0, 60));
			}
		});

	// Subscribe to bot transcripts from Pipecat and inject into chat history
	botTranscriptUnsub = pipecatClient.botTranscript.subscribe((data) => {
		if (!data || !data.text) return;

		dbg('[Pipecat-Chat] botTranscript:', data.text.substring(0, 60), 'msgId=', pipecatBotMsgId);

		// Update live overlay text and messages list
		liveBotText = data.text;
		// Update or add last bot message in liveMessages
		if (liveMessages.length > 0 && liveMessages[liveMessages.length - 1].role === 'assistant') {
			liveMessages[liveMessages.length - 1].text = data.text;
			liveMessages = liveMessages; // trigger reactivity
		} else {
			liveMessages = [...liveMessages, { role: 'assistant', text: data.text }];
		}
		// Auto-scroll transcript
		tick().then(() => {
			if (transcriptContainer) {
				transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
			}
		});

		if (!pipecatBotMsgId) {
				// Create new assistant message
				const msgId = uuidv4();
				const parentId = pipecatUserMsgId || history.currentId;

				dbg('[Pipecat-Chat] Creating bot msg:', msgId, 'parentId:', parentId);

				const botMessage = {
					id: msgId,
					parentId: parentId,
					childrenIds: [],
					role: 'assistant',
					content: data.text,
					model: modelId,
					timestamp: Math.floor(Date.now() / 1000),
					done: false
				};

				history.messages[msgId] = botMessage;
				if (parentId && history.messages[parentId]) {
					history.messages[parentId].childrenIds = [
						...(history.messages[parentId].childrenIds || []),
						msgId
					];
				}
				history.currentId = msgId;
				pipecatBotMsgId = msgId;
			} else {
				// Update existing assistant message with accumulated text
				history.messages[pipecatBotMsgId].content = data.text;
			}

			// Trigger Svelte reactivity — spread creates a new object reference
			// (plain `history = history` self-assignment may be optimized away)
			history = { ...history };

			dbg('[Pipecat-Chat] history updated, currentId:', history.currentId, 'msgCount:', Object.keys(history.messages).length);
		});

		// Handle barge-in: when the bot response is interrupted, finalize the
		// current message and reset pipecatBotMsgId so the next response creates
		// a fresh message block instead of overwriting the interrupted one.
		botInterruptedUnsub = pipecatClient.botResponseInterrupted.subscribe((ts) => {
			if (!ts) return;
			dbg('[Pipecat-Chat] botResponseInterrupted, msgId=', pipecatBotMsgId);

			if (pipecatBotMsgId && history.messages[pipecatBotMsgId]) {
				// Mark the interrupted message as done so UI doesn't show "Stop" button
				history.messages[pipecatBotMsgId].done = true;
				history = { ...history };
			}

			// Reset bot message ID so next bot_text creates a NEW message block
			pipecatBotMsgId = null;

			// Also add a visual separator in liveMessages so the user sees
			// the interrupted response as distinct from the next one
			if (liveMessages.length > 0 && liveMessages[liveMessages.length - 1].role === 'assistant') {
				// Mark the last assistant message as finalized by not touching it —
				// the next bot_text will create a new entry
			}
		});

		// Mark bot message as done when bot stops speaking
		pipecatClient.speaking.subscribe((isSpeaking) => {
			if (!isSpeaking && pipecatBotMsgId && history.messages[pipecatBotMsgId]) {
				history.messages[pipecatBotMsgId].done = true;
				history = { ...history };
			}
		});

		const pipecatUrl = $config?.audio?.pipecat?.url || 'http://localhost:7860';
		const pipecatMode = $config?.audio?.pipecat?.connection_mode || 'webrtc';

		// Connect without initial config
		await pipecatClient.connect(pipecatUrl, pipecatMode, null);
		} else {
			startRecording();
		}

		eventTarget.addEventListener('chat:start', chatStartHandler);
		eventTarget.addEventListener('chat', chatEventHandler);
		eventTarget.addEventListener('chat:finish', chatFinishHandler);

		return async () => {
			if (pipecatClient) {
				pipecatClient.disconnect();
			} else {
				await stopAllAudio();
			}

			stopAudioStream();

			eventTarget.removeEventListener('chat:start', chatStartHandler);
			eventTarget.removeEventListener('chat', chatEventHandler);
			eventTarget.removeEventListener('chat:finish', chatFinishHandler);

			audioAbortController.abort();
			await tick();

			await stopAllAudio();

			await stopRecordingCallback(false);
			await stopCamera();
		};
	});

	onDestroy(async () => {
		dbg('[CallOverlay] onDestroy triggered');

		// Mark any pending bot message as done so the UI doesn't get stuck showing Stop button
		if (pipecatBotMsgId && history.messages[pipecatBotMsgId]) {
			history.messages[pipecatBotMsgId].done = true;
			history = { ...history };
		}

		// ── UX Metrics: log final state and summary ──
		_uxLogStateChange('closed');
		_uxLogSummary();

		if (userTranscriptUnsub) userTranscriptUnsub();
		if (botTranscriptUnsub) botTranscriptUnsub();
		if (botInterruptedUnsub) botInterruptedUnsub();
		if (thinkingUnsub) thinkingUnsub();
		if (reconnectingUnsub) reconnectingUnsub();

		if (pipecatClient) {
			pipecatClient.disconnect();
		} else {
			await stopAllAudio();
		}

		await stopRecordingCallback(false);
		await stopCamera();

		await stopAudioStream();
		eventTarget.removeEventListener('chat:start', chatStartHandler);
		eventTarget.removeEventListener('chat', chatEventHandler);
		eventTarget.removeEventListener('chat:finish', chatFinishHandler);
		audioAbortController.abort();

		await tick();

		await stopAllAudio();
	});
</script>

<!-- Thin voice bar — sits just above the chat input -->
<div
	data-testid="call-overlay"
	role="status"
	aria-label="Voice Mode Active"
	class="w-full max-w-3xl mx-auto px-4 mb-2"
>
	<div class="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 shadow-sm">
		<!-- Status indicator orb -->
		<div class="relative flex items-center justify-center shrink-0">
			{#if loading}
				<div class="size-10 rounded-full mira-gradient flex items-center justify-center mira-breathe">
					<svg class="size-5 text-white" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
					</svg>
				</div>
			{:else if pipecatReconnecting}
				<div class="size-10 rounded-full mira-gradient flex items-center justify-center opacity-70">
					<svg class="size-5 text-white animate-spin" style="animation-duration: 2s" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 14.652" />
					</svg>
				</div>
			{:else if pipecatThinking}
				<div class="size-10 rounded-full mira-gradient flex items-center justify-center">
					<div class="flex items-center gap-1">
						<span class="size-1.5 bg-white rounded-full mira-thinking-dot" style="animation-delay: 0s" />
						<span class="size-1.5 bg-white rounded-full mira-thinking-dot" style="animation-delay: 0.2s" />
						<span class="size-1.5 bg-white rounded-full mira-thinking-dot" style="animation-delay: 0.4s" />
					</div>
				</div>
			{:else if assistantSpeaking}
				<button
					type="button"
					class="size-10 rounded-full mira-gradient flex items-center justify-center cursor-pointer hover:opacity-90 transition"
					on:click={() => stopAllAudio()}
					aria-label="Stop speaking"
				>
					<div class="flex items-end justify-center gap-0.5 h-5">
						{#each Array(4) as _, i}
							<div
								class="w-1 rounded-full mira-wave-bar"
								style="background: white; min-height: 4px; animation-delay: {i * 0.12}s"
							/>
						{/each}
					</div>
				</button>
			{:else}
				<!-- Listening — mic with subtle RMS -->
				<div
					class="absolute rounded-full transition-all duration-200 ease-out mira-gradient opacity-10"
					style="width: {40 + rmsLevel * 30}px; height: {40 + rmsLevel * 30}px"
				/>
				<div class="size-10 rounded-full mira-gradient flex items-center justify-center">
					<svg class="size-5 text-white" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
					</svg>
				</div>
			{/if}
		</div>

		<!-- Status text -->
		<div class="flex-1 min-w-0">
			{#if loading}
				<p class="text-sm font-medium text-violet-600 dark:text-violet-400 flex items-center gap-1.5">
					<span class="relative flex h-2 w-2">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
						<span class="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
					</span>
					{$i18n.t('Connecting...')}
				</p>
				<p class="text-xs text-gray-400 dark:text-gray-500">{$i18n.t('Setting up voice')}</p>
			{:else if pipecatReconnecting}
				<p class="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
					<span class="relative flex h-2 w-2">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
						<span class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
					</span>
					{$i18n.t('Reconnecting...')}
				</p>
			{:else if pipecatThinking}
				<p class="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1">
					{$i18n.t('Mira is thinking')}
					<span class="flex items-center gap-0.5 ml-0.5">
						<span class="size-1 bg-violet-500 rounded-full mira-thinking-dot" style="animation-delay: 0s"></span>
						<span class="size-1 bg-violet-500 rounded-full mira-thinking-dot" style="animation-delay: 0.2s"></span>
						<span class="size-1 bg-violet-500 rounded-full mira-thinking-dot" style="animation-delay: 0.4s"></span>
					</span>
				</p>
			{:else if assistantSpeaking}
				<p class="text-sm font-medium text-gray-700 dark:text-gray-200">{$i18n.t('Mira is speaking')}</p>
				<p class="text-xs text-gray-400 dark:text-gray-500">{$i18n.t('Tap orb to interrupt')}</p>
			{:else}
				<p class="text-sm font-medium text-green-600 dark:text-green-400 flex items-center gap-1.5">
					<span class="relative flex h-2 w-2">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
						<span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
					</span>
					{$i18n.t('Listening...')}
				</p>
				<p class="text-xs text-gray-400 dark:text-gray-500">{$i18n.t('Speak naturally')}</p>
			{/if}
		</div>

		<!-- End call button -->
		<button
			class="shrink-0 px-4 py-1.5 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-all shadow-sm"
			on:click={async () => {
				dbg('[CallOverlay] End button clicked - closing');
				// Mark all pending bot messages as done so the Stop button clears
				if (pipecatBotMsgId && history.messages[pipecatBotMsgId]) {
					history.messages[pipecatBotMsgId].done = true;
					history = { ...history };
				}
				try { await stopAudioStream(); } catch (e) { dbg('[CallOverlay] stopAudioStream error:', e); }
				try { await stopVideoStream(); } catch (e) { dbg('[CallOverlay] stopVideoStream error:', e); }
				showCallOverlay.set(false);
				dispatch('close');
			}}
			type="button"
			aria-label={$i18n.t('End voice')}
		>
			{$i18n.t('End')}
		</button>
	</div>

	<!-- Live transcript overlay during voice call -->
	{#if liveMessages.length > 0 || liveUserText || liveBotText}
		<div
			bind:this={transcriptContainer}
			class="mt-2 max-h-32 overflow-y-auto rounded-xl bg-white/90 dark:bg-gray-900/90 border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1.5 mira-frosted"
		>
			{#each liveMessages as msg, idx}
				<div class="flex {msg.role === 'assistant' ? '' : 'justify-end'} mira-msg-enter" style="animation-delay: {Math.min(idx * 30, 200)}ms">
					{#if msg.role === 'assistant'}
						<!-- Mira (bot) message — same layout as classroom -->
						<div class="flex items-start gap-1.5 max-w-[85%]">
							<div class="w-6 h-6 rounded-full mira-gradient flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5">M</div>
							<div>
								<div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 mira-gradient-text">Mira</div>
								<p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{msg.text}</p>
							</div>
						</div>
					{:else}
						<!-- User message — avatar initial + text bubble -->
						<div class="flex items-start gap-1.5 max-w-[85%]">
							<p class="text-xs text-white bg-violet-600 rounded-2xl rounded-br-md px-2.5 py-1.5 shadow-sm leading-relaxed">{msg.text}</p>
							<div class="w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5">
								{($user?.name || 'U').charAt(0).toUpperCase()}
							</div>
						</div>
					{/if}
				</div>
			{/each}
			{#if liveUserText}
				<div class="flex justify-end mira-msg-enter">
					<div class="flex items-start gap-1.5 max-w-[85%]">
						<p class="text-xs text-white bg-violet-600/80 rounded-2xl rounded-br-md px-2.5 py-1.5 shadow-sm leading-relaxed italic">
							{liveUserText}<span class="inline-block w-0.5 h-3 bg-violet-300 animate-pulse ml-0.5"></span>
						</p>
						<div class="w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5">
							{($user?.name || 'U').charAt(0).toUpperCase()}
						</div>
					</div>
				</div>
			{/if}
			{#if liveBotText && liveMessages.length > 0 && liveMessages[liveMessages.length - 1].role !== 'assistant'}
				<div class="flex mira-msg-enter">
					<div class="flex items-start gap-1.5 max-w-[85%]">
						<div class="w-6 h-6 rounded-full mira-gradient flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5 mira-glow">M</div>
						<div>
							<div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 mira-gradient-text">Mira</div>
							<p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
								{liveBotText}<span class="inline-block w-0.5 h-3 bg-violet-400 animate-pulse ml-0.5"></span>
							</p>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Powered by MIRA -->
	<div class="mt-1.5 flex items-center justify-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
		<span class="mira-gradient-text font-semibold">Powered by MIRA</span>
		<span>·</span>
		<span>Voice AI Tutor</span>
	</div>
</div>
