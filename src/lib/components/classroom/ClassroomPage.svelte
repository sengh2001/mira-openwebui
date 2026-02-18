<script lang="ts">
	import { onMount, onDestroy, getContext } from 'svelte';
	import { config, user, showSidebar } from '$lib/stores';
	import {
		classroomState,
		classroomRoom,
		classroomSelf,
		classroomMessages,
		classroomWs,
		classroomError,
		classroomTopics,
		isHandRaised,
		isSpeaker,
		isTeacher,
		currentLessonTopic,
		addClassroomMessage,
		updateMessageReaction,
		resetClassroom
	} from '$lib/stores/classroom';
	import {
		createRoom,
		listRooms,
		getRoom,
		deleteRoom,
		updateRoom,
		getTeacherStatus,
		requestTeacherRole,
		listTeacherRoleRequests,
		reviewTeacherRoleRequest,
		getClassroomWsUrl,
		getStoredToken,
		listSessions,
		getSession,
		getSessionSummary,
		getDashboard,
		type ClassroomRoom,
		type SessionRecord,
		type SessionMessage,
		type DashboardStats,
		type QuizQuestion,
		type TeacherRoleRequest,
		type ClassroomActor
	} from '$lib/apis/classroom';
	import { PipecatClient } from '$lib/services/pipecat';

	import ClassroomLobby from './ClassroomLobby.svelte';
	import ClassroomActive from './ClassroomActive.svelte';
	import ClassroomHistory from './ClassroomHistory.svelte';
	import ClassroomDashboard from './ClassroomDashboard.svelte';
	import ClassroomSettings from './ClassroomSettings.svelte';

	const i18n = getContext('i18n');

	// The Pipecat server URL (classroom API lives on the same server)
	$: pipecatBaseUrl = $config?.audio?.pipecat?.url || 'http://localhost:7860';

	let rooms: ClassroomRoom[] = [];
	let loading = false;
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let lobbyPollInterval: ReturnType<typeof setInterval> | null = null;
	let roomListPollInFlight = false;
	let teacherStatusPollInFlight = false;

	// ── Speaker voice pipeline ────────────────────────────────────
	let speakerPipecat: PipecatClient | null = null;
	let speakerConnected = false;
	let speakerListening = false;
	let speakerError: string | null = null;
	let speakerBotText = '';
	let speakerUserText = '';
	let speakerUnsubs: Array<() => void> = [];

	// ── Join preferences ──────────────────────────────────────────
	let userName = $user?.name || 'User';
	let userLanguage = 'en';
	// Listener playback preference (used both for join and for gating audio playback).
	// Default to text_only (safer; avoids unexpected autoplay/audio).
	const CLASSROOM_USER_MODE_KEY = 'classroom_user_mode';
	let userMode: 'text_and_audio' | 'text_only' = 'text_only';
	let classroomUserId = '';

	function loadStoredUserMode() {
		try {
			const stored = localStorage.getItem(CLASSROOM_USER_MODE_KEY);
			if (stored === 'text_only' || stored === 'text_and_audio') {
				userMode = stored;
			}
		} catch {
			// ignore
		}
	}

	function persistUserMode(mode: 'text_and_audio' | 'text_only') {
		try {
			localStorage.setItem(CLASSROOM_USER_MODE_KEY, mode);
		} catch {
			// ignore
		}
	}

	function getClassroomUserId() {
		// Prefer authenticated OpenWebUI user ID when available.
		// This prevents identity reuse across accounts on shared browsers.
		const authUserId = ($user?.id || '').trim();
		if (authUserId) return authUserId;

		try {
			const key = 'classroom_user_id';
			let stored = localStorage.getItem(key);
			if (!stored) {
				if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
					stored = crypto.randomUUID();
				} else {
					stored = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				}
				localStorage.setItem(key, stored);
			}
			return stored;
		} catch {
			return $user?.id || `user-${Date.now()}`;
		}
	}

	function getActor(): ClassroomActor {
		return {
			user_id: classroomUserId || getClassroomUserId(),
			user_name: userName || $user?.name || 'User',
			user_email: $user?.email || '',
			user_role: $user?.role || 'user',
			token: getStoredToken() || undefined
		};
	}

	function getActorUserId(): string {
		return classroomUserId || getClassroomUserId();
	}

	// Speaker input mode: voice (mic active, Pipecat connected) or text (text input, direct LLM)
	let speakerMode: 'voice' | 'text' = 'text';

	// ── Welcome back toast ───────────────────────────────────────
	let welcomeToast = '';
	let welcomeToastTimer: ReturnType<typeof setTimeout> | null = null;

	function showWelcomeToast(name: string, language: string) {
		const langNames: Record<string, string> = {
			en: 'English',
			hi: 'Hindi',
			ta: 'Tamil'
		};
		const langLabel = langNames[language] || language;
		welcomeToast = `Welcome back, ${name}! 🎉 (${langLabel})`;
		if (welcomeToastTimer) clearTimeout(welcomeToastTimer);
		welcomeToastTimer = setTimeout(() => { welcomeToast = ''; }, 4000);
	}

	// ── Session history state ─────────────────────────────────────
	let sessions: SessionRecord[] = [];
	let selectedSession: { session: SessionRecord; messages: SessionMessage[] } | null = null;
	let sessionSummary: { summary: string; key_concepts?: string[]; quiz?: QuizQuestion[] } | null = null;
	let loadingSummary = false;

	// ── Dashboard state ──────────────────────────────────────────
	let dashboardStats: DashboardStats | null = null;

	// ── Teacher access workflow ──────────────────────────────────
	let canCreateRooms = false;
	let canDeleteRooms = false;
	let teacherRequestPending = false;
	let teacherRequests: TeacherRoleRequest[] = [];
	let loadingTeacherRequests = false;

	// ── Listener audio playback ──────────────────────────────────
	let audioContext: AudioContext | null = null;
	let audioQueue: Float32Array[] = [];
	let isPlayingAudio = false;
	const AUDIO_SAMPLE_RATE = 24000;

	function ensureAudioContext() {
		if (!audioContext || audioContext.state === 'closed') {
			audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
		}
		if (audioContext.state === 'suspended') {
			audioContext.resume();
		}
		return audioContext;
	}

	function queueAudioChunk(rawBytes: ArrayBuffer) {
		// Convert raw PCM 16-bit LE to Float32
		const int16 = new Int16Array(rawBytes);
		const float32 = new Float32Array(int16.length);
		for (let i = 0; i < int16.length; i++) {
			float32[i] = int16[i] / 32768.0;
		}
		audioQueue.push(float32);
		if (audioQueue.length === 1) {
			console.log('[Classroom Audio] First chunk queued, samples:', int16.length);
		}
		if (!isPlayingAudio) {
			playNextChunk();
		}
	}

	function playNextChunk() {
		if (audioQueue.length === 0) {
			isPlayingAudio = false;
			return;
		}
		isPlayingAudio = true;
		const ctx = ensureAudioContext();
		if (ctx.state === 'suspended') {
			// Safari may still be suspended — try resuming (may require user gesture)
			console.warn('[Classroom Audio] AudioContext is suspended, attempting resume...');
			ctx.resume().then(() => {
				console.log('[Classroom Audio] AudioContext resumed, state:', ctx.state);
				playNextChunk(); // retry after resume
			}).catch((e) => {
				console.error('[Classroom Audio] Failed to resume AudioContext:', e);
			});
			return;
		}
		const chunk = audioQueue.shift()!;
		const buffer = ctx.createBuffer(1, chunk.length, AUDIO_SAMPLE_RATE);
		buffer.getChannelData(0).set(chunk);
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(ctx.destination);
		source.onended = () => playNextChunk();
		source.start();
	}

	function stopAudioPlayback() {
		audioQueue = [];
		isPlayingAudio = false;
	}

	// ── Speaker pipeline management ───────────────────────────────

	async function connectSpeakerPipeline() {
		if (speakerPipecat) return; // already connected

		const roomId = $classroomRoom?.room_id;
		const selfId = $classroomSelf?.user_id;
		if (!roomId || !selfId) return;

		speakerPipecat = new PipecatClient();
		speakerPipecat.classroomConfig = { room_id: roomId, speaker_id: selfId };

		// Subscribe to pipeline state
		speakerUnsubs.push(
			speakerPipecat.connected.subscribe((val) => { speakerConnected = val; }),
			speakerPipecat.listening.subscribe((val) => { speakerListening = val; }),
			speakerPipecat.error.subscribe((val) => { speakerError = val; }),
			speakerPipecat.botTranscript.subscribe((val) => {
				if (val.text) {
					speakerBotText = val.text;
				}
			}),
			speakerPipecat.botResponseComplete.subscribe((ts) => {
				if (ts && speakerBotText) {
					addClassroomMessage('assistant', speakerBotText, 'Mira');
					speakerBotText = '';
				}
			}),
			speakerPipecat.botResponseInterrupted.subscribe((ts) => {
				if (ts && speakerBotText) {
					// Finalize the interrupted partial response as a separate message
					addClassroomMessage('assistant', speakerBotText, 'Mira');
					speakerBotText = '';
				}
			}),
			speakerPipecat.userTranscript.subscribe((val: any) => {
				if (val.text) {
					speakerUserText = val.text;
					if (val.final) {
						// Clean up the transcript prefix if present
						let cleanText = val.text;
						const prefixMatch = cleanText.match(/^(?:\[.*?\]\s*)?(?:Speaker \d+:\s*)?(.+)/);
						if (prefixMatch) cleanText = prefixMatch[1];
						addClassroomMessage('user', cleanText, userName);
						// Voice-path question fanout: explicitly send final transcript to
						// classroom WS so listeners always receive speaker questions.
						const ws = $classroomWs;
						if (ws && ws.readyState === WebSocket.OPEN) {
							ws.send(JSON.stringify({ type: 'speaker_transcript', text: cleanText }));
						}
						speakerUserText = '';
					}
				}
			})
		);

		try {
			await speakerPipecat.connect(pipecatBaseUrl, 'websocket', null);
		} catch (err: any) {
			console.warn('[Classroom] Speaker pipeline connect failed:', err?.message || err);
			speakerError = err?.message || 'Voice connection failed. Try switching to text mode.';
			// Clean up the failed pipeline so user can retry
			disconnectSpeakerPipeline();
		}
	}

	function disconnectSpeakerPipeline() {
		if (speakerPipecat) {
			speakerPipecat.disconnect();
			speakerPipecat = null;
		}
		speakerUnsubs.forEach((unsub) => unsub());
		speakerUnsubs = [];
		speakerConnected = false;
		speakerListening = false;
		speakerError = null;
		speakerBotText = '';
		speakerUserText = '';
	}

	// React to speaker status + mode changes — auto-connect/disconnect voice pipeline
	$: if ($isSpeaker && $classroomState === 'active' && speakerMode === 'voice' && !speakerPipecat) {
		connectSpeakerPipeline();
	}
	$: if ((!$isSpeaker || speakerMode === 'text') && speakerPipecat) {
		disconnectSpeakerPipeline();
	}
	// Reset mode when losing speaker status
	$: if (!$isSpeaker) {
		speakerMode = 'text';
	}

	// ── Lifecycle ─────────────────────────────────────────────────

	onMount(async () => {
		classroomUserId = getClassroomUserId();
		loadStoredUserMode();
		await refreshTeacherAccess();
		await refreshTeacherRequests();
		await refreshRooms();
		startLobbyPolling();
	});

	onDestroy(() => {
		if (pollInterval) clearInterval(pollInterval);
		if (lobbyPollInterval) clearInterval(lobbyPollInterval);
		stopAudioPlayback();
		if (audioContext) { audioContext.close(); audioContext = null; }
		disconnectSpeakerPipeline();
		resetClassroom();
	});

	// ── Rooms ─────────────────────────────────────────────────────

	async function refreshTeacherAccess() {
		try {
			const status = await getTeacherStatus(pipecatBaseUrl, getActor());
			canCreateRooms = Boolean(status.is_admin || status.is_teacher);
			canDeleteRooms = canCreateRooms;
			teacherRequestPending = status.latest_request?.status === 'pending';
		} catch (e) {
			console.warn('[Classroom] Failed to load teacher status:', e);
			canCreateRooms = ($user?.role === 'admin');
			canDeleteRooms = canCreateRooms;
			teacherRequestPending = false;
		}
	}

	async function refreshTeacherRequests() {
		if ($user?.role !== 'admin') {
			teacherRequests = [];
			return;
		}
		loadingTeacherRequests = true;
		try {
			teacherRequests = await listTeacherRoleRequests(pipecatBaseUrl, getActor(), 'pending');
		} catch (e) {
			console.warn('[Classroom] Failed to load teacher requests:', e);
			teacherRequests = [];
		} finally {
			loadingTeacherRequests = false;
		}
	}

	async function handleRequestTeacherRole(purpose: string) {
		try {
			await requestTeacherRole(pipecatBaseUrl, getActor(), purpose);
			teacherRequestPending = true;
			classroomError.set('');
		} catch (e: any) {
			classroomError.set(e.message || 'Failed to submit teacher request');
		}
	}

	async function handleApproveTeacherRequest(requestId: string) {
		try {
			await reviewTeacherRoleRequest(pipecatBaseUrl, getActor(), requestId, true);
			await refreshTeacherRequests();
		} catch (e: any) {
			classroomError.set(e.message || 'Failed to approve request');
		}
	}

	async function handleRejectTeacherRequest(requestId: string) {
		try {
			await reviewTeacherRoleRequest(pipecatBaseUrl, getActor(), requestId, false);
			await refreshTeacherRequests();
		} catch (e: any) {
			classroomError.set(e.message || 'Failed to reject request');
		}
	}

	async function refreshRooms(options?: { silent?: boolean }) {
		const silent = options?.silent ?? false;
		if (!silent) loading = true;
		try {
			rooms = await listRooms(pipecatBaseUrl);
		} catch (e: any) {
			console.warn('[Classroom] Failed to list rooms:', e.message);
			rooms = [];
		} finally {
			if (!silent) loading = false;
		}
	}

	function startLobbyPolling() {
		if (lobbyPollInterval) return;
		lobbyPollInterval = setInterval(async () => {
			if ($classroomState !== 'lobby') return;
			if (roomListPollInFlight || teacherStatusPollInFlight) return;
			roomListPollInFlight = true;
			teacherStatusPollInFlight = true;
			try {
				await Promise.all([
					refreshRooms({ silent: true }),
					refreshTeacherAccess()
				]);
			} finally {
				roomListPollInFlight = false;
				teacherStatusPollInFlight = false;
			}
		}, 1000);
	}

	async function handleCreateRoom(detail: any) {
		if (!canCreateRooms) {
			classroomError.set('Only approved teachers can create rooms');
			return;
		}
		try {
			const name = typeof detail === 'string' ? detail : detail?.name;
			const topic = typeof detail === 'string' ? undefined : detail?.topic;
			const isPermanent = typeof detail === 'string' ? false : Boolean(detail?.is_permanent);
			const roomType = typeof detail === 'string' ? undefined : detail?.room_type;
			const curriculumChapterId =
				typeof detail === 'string' ? undefined : detail?.curriculum_chapter_id;
			const curriculumSectionId =
				typeof detail === 'string' ? undefined : detail?.curriculum_section_id;
			const room = await createRoom(pipecatBaseUrl, name, getActor(), {
				topic,
				teacher_name: userName,
				is_permanent: isPermanent,
				room_type: roomType,
				curriculum_chapter_id: curriculumChapterId,
				curriculum_section_id: curriculumSectionId
			});
			rooms = [...rooms, room];
			// Auto-join after create
			await handleJoinRoom(room.room_id);
		} catch (e: any) {
			classroomError.set(e.message);
		}
	}


	async function handleSaveRoom(detail: {
		room_id: string;
		name: string;
		topic?: string;
		teacher_id?: string;
		room_type?: string;
		curriculum_chapter_id?: string;
		curriculum_section_id?: string;
	}) {
		try {
			const opts: {
				name?: string;
				topic?: string;
				teacher_id?: string;
				room_type?: string;
				curriculum_chapter_id?: string;
				curriculum_section_id?: string;
			} = {
				name: detail.name,
				topic: detail.topic
			};
			if (detail.teacher_id) opts.teacher_id = detail.teacher_id;
			if (detail.room_type) opts.room_type = detail.room_type;
			if (detail.curriculum_chapter_id) opts.curriculum_chapter_id = detail.curriculum_chapter_id;
			if (detail.curriculum_section_id) opts.curriculum_section_id = detail.curriculum_section_id;
			await updateRoom(pipecatBaseUrl, detail.room_id, opts);
			await refreshRooms();
		} catch (e: any) {
			classroomError.set(e.message || 'Failed to update room');
		}
	}

	async function handleDeleteRoom(roomId: string) {
		try {
			await deleteRoom(pipecatBaseUrl, roomId, getActor());
			rooms = rooms.filter((r) => r.room_id !== roomId);
			classroomError.set('');
		} catch (e: any) {
			console.warn('[Classroom] Delete failed:', e.message);
			classroomError.set(e.message || 'Failed to delete room');
		}
	}

	// ── Join Room ─────────────────────────────────────────────────

	async function handleJoinRoom(roomId: string) {
		classroomState.set('joining');
		classroomError.set('');

		// Pre-initialize AudioContext during this user-gesture (click) so Safari
		// allows audio playback later when binary frames arrive via WebSocket.
		if (userMode === 'text_and_audio') {
			ensureAudioContext();
		}

		try {
			const wsUrl = getClassroomWsUrl(pipecatBaseUrl, roomId);
			const ws = new WebSocket(wsUrl);
			classroomWs.set(ws);

			ws.binaryType = 'arraybuffer';

			ws.onopen = () => {
				const userId = classroomUserId || getClassroomUserId();
				// Send join message (includes JWT token for server-side verification)
				const joinMsg: Record<string, string> = {
					type: 'join',
					user_id: userId,
					name: userName,
					language: userLanguage,
					mode: userMode
				};
				const jwtToken = getStoredToken();
				if (jwtToken) {
					joinMsg.token = jwtToken;
				}
				ws.send(JSON.stringify(joinMsg));
			};

			ws.onmessage = (event) => {
				// Binary audio data — queue for playback
				if (event.data instanceof ArrayBuffer) {
					if (userMode === 'text_and_audio' && !$isSpeaker) {
						queueAudioChunk(event.data);
					}
					return;
				}
				// Safari may deliver binary as Blob instead of ArrayBuffer
				if (event.data instanceof Blob) {
					if (userMode === 'text_and_audio' && !$isSpeaker) {
						event.data.arrayBuffer().then((buf) => queueAudioChunk(buf));
					}
					return;
				}

				// JSON text message
				try {
					const data = JSON.parse(event.data);
					handleWsMessage(data);
				} catch {
					// Non-JSON string — ignore
				}
			};

			ws.onerror = (err) => {
				console.warn('[Classroom] WS error:', err);
				classroomError.set('WebSocket connection error');
				classroomState.set('error');
			};

			ws.onclose = () => {
				console.warn('[Classroom] WS closed');
				if ($classroomState === 'active') {
					// Go back to lobby — user must click Join again
					console.warn('[Classroom] Connection lost, returning to lobby');
					disconnectSpeakerPipeline();
					classroomState.set('lobby');
					classroomRoom.set(null);
					classroomSelf.set(null);
					classroomWs.set(null);
					refreshRooms();
				}
			};

			// Start polling room state for live updates
			pollInterval = setInterval(async () => {
				if ($classroomState === 'active' && $classroomRoom) {
					try {
						const updated = await getRoom(pipecatBaseUrl, $classroomRoom.room_id);
						classroomRoom.set(updated);
					} catch {
						// Room might be deleted
					}
				}
			}, 3000);
		} catch (e: any) {
			classroomError.set(e.message);
			classroomState.set('error');
		}
	}

	// ── WS Message Handler ────────────────────────────────────────

	function handleWsMessage(data: any) {
		switch (data.type) {
		case 'joined':
			classroomRoom.set(data.room);
			classroomSelf.set(data.you);
			// Hydrate shared chat so late joiners can see existing conversation.
			classroomMessages.set(
				Array.isArray(data.recent_messages)
					? data.recent_messages.map((m: any) => ({
							id: m.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
							role: m.role === 'assistant' ? 'assistant' : 'user',
							speaker_name: m.speaker_name,
							content: m.content || '',
							translated: !!m.translated,
							timestamp: typeof m.timestamp === 'number'
								? (m.timestamp < 1e12 ? m.timestamp * 1000 : m.timestamp)
								: Date.now(),
							reaction_counts: m.reaction_counts || {},
							db_message_id: m.id || undefined
						}))
					: []
			);
			// Keep local mode in sync with the server-accepted mode (and persist it).
			if (data?.you?.mode === 'text_only' || data?.you?.mode === 'text_and_audio') {
				userMode = data.you.mode;
				persistUserMode(userMode);
			}
			// Detect returning user: server may update name/language from DB profile
			// Show welcome back toast if the server recognized them
			if (data.you?.name && data.you.name !== 'User' && data.you.name !== `User-${(data.you.user_id || '').slice(0, 4)}`) {
				// Update local userName if server sent back a persisted name
				if (data.you.name !== userName) {
					userName = data.you.name;
				}
				if (data.you.language && data.you.language !== userLanguage) {
					userLanguage = data.you.language;
				}
				showWelcomeToast(data.you.name, data.you.language || 'en');
			}
			classroomState.set('active');
			break;

		case 'token_changed':
			classroomRoom.update((r) => {
				if (r)
					return {
						...r,
						speaker_id: data.speaker_id ?? null,
						speaker_name: data.speaker_name ?? null
					};
				return r;
			});
			classroomSelf.update((s) => {
				if (s) return { ...s, is_speaker: s.user_id === (data.speaker_id ?? null) };
				return s;
			});
			break;

			case 'token_response':
				if (data.granted) {
					classroomSelf.update((s) => (s ? { ...s, is_speaker: true } : s));
				}
				break;

			case 'user_joined':
				classroomRoom.update((r) => {
					if (!r) return r;
					const exists = r.users.some((u) => u.user_id === data.user.user_id);
					if (!exists) {
						return { ...r, users: [...r.users, data.user], user_count: r.user_count + 1 };
					}
					return r;
				});
				break;

			case 'user_left':
				classroomRoom.update((r) => {
					if (!r) return r;
					return {
						...r,
						users: r.users.filter((u) => u.user_id !== data.user_id),
						user_count: Math.max(0, r.user_count - 1)
					};
				});
				break;

			case 'transcription':
				console.warn('[Classroom] transcription event received:', {
					speaker: data.speaker_name,
					text: (data.translated_text || data.text || '').slice(0, 60),
					hasTranslation: !!data.translated_text,
				});
				addClassroomMessage(
					'user',
					data.translated_text || data.text,
					data.speaker_name,
					!!data.translated_text && data.translated_text !== data.text
				);
				break;

			case 'bot_response':
				// Legacy/voice-mode path: full response in one message.
				// If a streaming message is in progress, finalize it; otherwise add new.
				classroomMessages.update((msgs) => {
					const lastIdx = msgs.length - 1;
					const last = lastIdx >= 0 ? msgs[lastIdx] : null;
					const finalText = data.translated_text || data.text;
					const isTranslated = !!data.translated_text && data.translated_text !== data.text;
					if (last && last.role === 'assistant' && last._streaming) {
						return [
							...msgs.slice(0, lastIdx),
							{ ...last, content: finalText, _streaming: false, translated: isTranslated }
						];
					}
					return [
						...msgs,
						{
							id: `msg-${Date.now()}`,
							role: 'assistant' as const,
							content: finalText,
							speaker_name: 'Mira',
							timestamp: Date.now(),
							translated: isTranslated,
						}
					];
				});
				break;

			case 'bot_text':
				classroomMessages.update((msgs) => {
					const last = msgs[msgs.length - 1];
					if (last && last.role === 'assistant' && last._streaming) {
						return [
							...msgs.slice(0, -1),
							{ ...last, content: last.content + (data.text || '') }
						];
					}
					return [
						...msgs,
						{
							id: `msg-${Date.now()}`,
							role: 'assistant' as const,
							content: data.text || '',
							speaker_name: 'Mira',
							timestamp: Date.now(),
							_streaming: true,
						}
					];
				});
				speakerBotText = data.text || '';
				break;

			case 'bot_text_complete':
				classroomMessages.update((msgs) => {
					const last = msgs[msgs.length - 1];
					if (last && last.role === 'assistant' && last._streaming) {
						return [
							...msgs.slice(0, -1),
							{
								...last,
								content: data.text || last.content,
								_streaming: false,
								_interrupted: !!data.interrupted
							}
						];
					}
					if (data.text) {
						return [
							...msgs,
							{
								id: `msg-${Date.now()}`,
								role: 'assistant' as const,
								content: data.text,
								speaker_name: 'Mira',
								timestamp: Date.now(),
								_interrupted: !!data.interrupted
							}
						];
					}
					return msgs;
				});
				speakerBotText = '';
				break;

			case 'bot_audio_start':
				if (userMode === 'text_and_audio' && !$isSpeaker) {
					ensureAudioContext();
				}
				break;

			case 'bot_audio_end':
				break;

			case 'mode_changed':
				classroomSelf.update((s) => (s ? { ...s, mode: data.mode } : s));
				if (data?.mode === 'text_only' || data?.mode === 'text_and_audio') {
					userMode = data.mode;
					persistUserMode(userMode);
					// If user switched to text_only, stop any pending audio playback.
					if (userMode === 'text_only') {
						stopAudioPlayback();
					}
				}
				break;

			// ── Hand Raise Events ──
			case 'hand_raised':
				classroomRoom.update((r) => {
					if (!r) return r;
					const raises = [...(r.hand_raises || [])];
					if (!raises.find((hr) => hr.id === data.raise.id)) {
						raises.push(data.raise);
					}
					return { ...r, hand_raises: raises };
				});
				break;

			case 'hand_lowered':
				classroomRoom.update((r) => {
					if (!r) return r;
					return {
						...r,
						hand_raises: (r.hand_raises || []).filter(
							(hr) => !(hr.user_id === data.user_id && hr.status === 'pending')
						)
					};
				});
				// If it was our hand
				if (data.user_id === $classroomSelf?.user_id) {
					isHandRaised.set(false);
				}
				break;

			case 'hand_acknowledged':
				classroomRoom.update((r) => {
					if (!r) return r;
					return {
						...r,
						hand_raises: (r.hand_raises || []).map((hr) =>
							hr.id === data.raise.id ? { ...hr, ...data.raise } : hr
						)
					};
				});
				if (data.raise.user_id === $classroomSelf?.user_id) {
					isHandRaised.set(false);
				}
				break;

			case 'hand_dismissed':
				classroomRoom.update((r) => {
					if (!r) return r;
					return {
						...r,
						hand_raises: (r.hand_raises || []).map((hr) =>
							hr.id === data.raise.id ? { ...hr, ...data.raise } : hr
						)
					};
				});
				if (data.raise.user_id === $classroomSelf?.user_id) {
					isHandRaised.set(false);
				}
				break;

			// ── Reaction Events ──
			case 'reaction_update':
				updateMessageReaction(
					data.message_id,
					data.emoji,
					data.action === 'add' ? 1 : -1
				);
				break;

		// ── Topic Suggestions ──
		case 'topic_suggestions':
			classroomTopics.set(data.topics || []);
			break;

		// ── Lesson Topic Changed ──
		case 'lesson_topic_changed':
			currentLessonTopic.set(data.topic || '');
			classroomRoom.update((r) => r ? { ...r, current_lesson_topic: data.topic || null } : r);
			break;

		// ── Teacher Changed ──
		case 'teacher_changed':
			classroomRoom.update((r) => r ? { ...r, teacher_id: data.teacher_id } : r);
			break;

		// ── Teacher Action Result ──
		case 'teacher_action_result':
			// Acknowledge teacher action (kick, promote, etc.)
			break;

		// ── Kicked from room ──
		case 'kicked':
			classroomError.set(data.message || 'You were removed from the room');
			handleLeaveRoom();
			break;

		case 'error':
			classroomError.set(data.message || 'Unknown error');
			break;

			default:
				console.warn('[Classroom] Unknown WS msg:', data.type);
		}
	}

	// ── Leave Room ────────────────────────────────────────────────

	function handleLeaveRoom() {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
		stopAudioPlayback();
		if (audioContext) {
			audioContext.close();
			audioContext = null;
		}
		disconnectSpeakerPipeline();
		resetClassroom();
		refreshRooms();
	}

	// ── Mode Toggle (voice ↔ text) ───────────────────────────────

	function handleToggleMode(newMode: 'voice' | 'text') {
		speakerMode = newMode;
	}

	// ── Listener Playback Mode (Text Only ↔ Text + Audio) ─────────

	function handleSetPlaybackMode(newMode: 'text_and_audio' | 'text_only') {
		userMode = newMode;
		persistUserMode(newMode);
		if (newMode === 'text_only') {
			stopAudioPlayback();
		}
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'set_mode', mode: newMode }));
		}
	}

	// ── Text Message (speaker types a question) ──────────────────

	function handleSendMessage(text: string) {
		if (!text || !$isSpeaker) return;

		// Add to local messages immediately
		addClassroomMessage('user', text, userName);

		// Send to classroom WS — backend will query LLM, stream response, and broadcast
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'text_message', text }));
		}
	}

	// ── Token Controls ────────────────────────────────────────────

	function requestToken() {
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'request_token' }));
		}
	}

	function releaseToken() {
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'release_token' }));
		}
	}

	function passToken(toUserId?: string) {
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'pass_token', to: toUserId }));
		}
	}

	// ── Hand Raise Controls ──────────────────────────────────────

	function handleRaiseHand(question?: string) {
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'hand_raise', question_preview: question || '' }));
			isHandRaised.set(true);
		}
	}

	function handleLowerHand() {
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'hand_lower' }));
			isHandRaised.set(false);
		}
	}

	function handleAcknowledgeHand(raiseId: string) {
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'hand_acknowledge', raise_id: raiseId }));
		}
	}

	function handleDismissHand(raiseId: string) {
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'hand_dismiss', raise_id: raiseId }));
		}
	}

	// ── Reaction Controls ────────────────────────────────────────

	function handleReaction(messageId: string, emoji: string) {
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'reaction', message_id: messageId, emoji, action: 'add' }));
		}
	}

	// ── Teacher Actions ─────────────────────────────────────────

	function handleTeacherAction(action: string, payload: string = '') {
		if (!$isTeacher) return;
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'teacher_action', action, payload }));
			// Add a visual indicator to local messages for the teacher
			const labels: Record<string, string> = {
				SET_TOPIC: `📝 Topic: ${payload}`,
				QUIZ: '❓ Quiz time!',
				SUMMARIZE: '📋 Summarizing the lesson...',
				SIMPLIFY: '🔄 Simplifying...',
				NEXT: '⏭️ Next topic...',
			};
			addClassroomMessage('user', labels[action] || action, userName);
		}
	}

	// ── Update Curriculum Selection (from teacher toolbar dropdowns) ───
	async function handleUpdateCurriculum(detail: { curriculum_chapter_id: string; curriculum_section_id: string }) {
		if (!currentRoomId) return;
		try {
			await updateRoom(pipecatBaseUrl, currentRoomId, {
				curriculum_chapter_id: detail.curriculum_chapter_id,
				curriculum_section_id: detail.curriculum_section_id
			});
		} catch (e) {
			console.warn('[Classroom] Failed to persist curriculum selection:', e);
		}
	}

	// ── Topic Suggestions ────────────────────────────────────────

	function handleRequestTopics() {
		const ws = $classroomWs;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'request_topics' }));
		}
	}

	function handleSelectTopic(topic: string) {
		if ($isSpeaker) {
			handleSendMessage(topic);
		}
	}

	// ── Session History ──────────────────────────────────────────

	async function handleViewHistory() {
		classroomState.set('history');
		try {
			sessions = await listSessions(pipecatBaseUrl);
		} catch (e: any) {
			console.warn('[Classroom] Failed to load sessions:', e.message);
			sessions = [];
		}
	}

	async function handleSelectSession(sessionId: string) {
		try {
			selectedSession = await getSession(pipecatBaseUrl, sessionId);
			sessionSummary = null;
		} catch (e: any) {
			console.warn('[Classroom] Failed to load session:', e.message);
		}
	}

	async function handleGenerateSummary(sessionId: string) {
		loadingSummary = true;
		try {
			sessionSummary = await getSessionSummary(pipecatBaseUrl, sessionId);
		} catch (e: any) {
			console.warn('[Classroom] Failed to generate summary:', e.message);
		} finally {
			loadingSummary = false;
		}
	}

	// ── Dashboard ────────────────────────────────────────────────

	async function handleViewDashboard() {
		classroomState.set('dashboard');
		try {
			dashboardStats = await getDashboard(pipecatBaseUrl);
		} catch (e: any) {
			console.warn('[Classroom] Failed to load dashboard:', e.message);
			dashboardStats = null;
		}
	}

	function handleViewSettings() {
		classroomState.set('settings');
		refreshRooms();
	}

	function handleBackToLobby() {
		classroomState.set('lobby');
		selectedSession = null;
		sessionSummary = null;
		refreshTeacherAccess();
		refreshTeacherRequests();
		refreshRooms();
	}
</script>

<!-- Welcome Back Toast -->
{#if welcomeToast}
	<div class="fixed top-4 left-1/2 -translate-x-1/2 z-[60] mira-msg-enter pointer-events-none">
		<div class="flex items-center gap-2.5 px-5 py-3 rounded-2xl shadow-xl border bg-gradient-to-r from-violet-50 via-white to-indigo-50 dark:from-violet-900/60 dark:via-gray-900 dark:to-indigo-900/60 border-violet-200 dark:border-violet-700 text-violet-800 dark:text-violet-200">
			<div class="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-sm shadow-md">
				👋
			</div>
			<span class="text-sm font-medium">{welcomeToast}</span>
		</div>
	</div>
{/if}

<div
	class="h-screen max-h-[100dvh] w-full flex flex-col {$showSidebar
		? 'md:max-w-[calc(100%-var(--sidebar-width))]'
		: ''}"
>
	{#if $classroomState === 'active' && $classroomRoom && $classroomSelf}
		<ClassroomActive
			room={$classroomRoom}
			self={$classroomSelf}
			messages={$classroomMessages}
			isSpeaker={$isSpeaker}
			isTeacher={$isTeacher}
			isHandRaised={$isHandRaised}
			topics={$classroomTopics}
			lessonTopic={$currentLessonTopic}
			error={$classroomError}
			{pipecatBaseUrl}
			{speakerConnected}
			{speakerListening}
			{speakerError}
			{speakerUserText}
			{speakerBotText}
			{speakerMode}
			on:leave={handleLeaveRoom}
			on:requestToken={requestToken}
			on:releaseToken={releaseToken}
			on:passToken={(e) => passToken(e.detail)}
			on:sendMessage={(e) => handleSendMessage(e.detail)}
			on:toggleMode={(e) => handleToggleMode(e.detail)}
			on:setPlaybackMode={(e) => handleSetPlaybackMode(e.detail)}
			on:raiseHand={(e) => handleRaiseHand(e.detail)}
			on:lowerHand={handleLowerHand}
			on:acknowledgeHand={(e) => handleAcknowledgeHand(e.detail)}
			on:dismissHand={(e) => handleDismissHand(e.detail)}
			on:reaction={(e) => handleReaction(e.detail.messageId, e.detail.emoji)}
			on:requestTopics={handleRequestTopics}
			on:selectTopic={(e) => handleSelectTopic(e.detail)}
			on:teacherAction={(e) => handleTeacherAction(e.detail.action, e.detail.payload)}
			on:updateCurriculum={(e) => handleUpdateCurriculum(e.detail)}
		/>
	{:else if $classroomState === 'history'}
		<ClassroomHistory
			{sessions}
			{selectedSession}
			{sessionSummary}
			{loadingSummary}
			on:back={handleBackToLobby}
			on:selectSession={(e) => handleSelectSession(e.detail)}
			on:generateSummary={(e) => handleGenerateSummary(e.detail)}
		/>
	{:else if $classroomState === 'dashboard'}
		<ClassroomDashboard
			stats={dashboardStats}
			on:back={handleBackToLobby}
		/>
	{:else if $classroomState === 'settings'}
		<ClassroomSettings
			{rooms}
			{loading}
			{pipecatBaseUrl}
			on:back={handleBackToLobby}
			on:saveRoom={(e) => handleSaveRoom(e.detail)}
			on:deleteRoom={(e) => handleDeleteRoom(e.detail)}
		/>
	{:else}
		<ClassroomLobby
			{rooms}
			{loading}
			{pipecatBaseUrl}
			{canCreateRooms}
			{canDeleteRooms}
			actorUserId={getActorUserId()}
			isAdmin={$user?.role === 'admin'}
			{teacherRequestPending}
			{teacherRequests}
			{loadingTeacherRequests}
			bind:userName
			bind:userLanguage
			classroomUserId={classroomUserId}
			joining={$classroomState === 'joining'}
			error={$classroomError}
			on:create={(e) => handleCreateRoom(e.detail)}
			on:join={(e) => handleJoinRoom(e.detail)}
			on:delete={(e) => handleDeleteRoom(e.detail)}
			on:requestTeacher={(e) => handleRequestTeacherRole(e.detail)}
			on:approveTeacherRequest={(e) => handleApproveTeacherRequest(e.detail)}
			on:rejectTeacherRequest={(e) => handleRejectTeacherRequest(e.detail)}
			on:refreshTeacherRequests={refreshTeacherRequests}
			on:refresh={refreshRooms}
			on:viewHistory={handleViewHistory}
			on:viewDashboard={handleViewDashboard}
			on:viewSettings={handleViewSettings}
		/>
	{/if}
</div>
