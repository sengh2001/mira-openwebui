/**
 * Classroom API client — talks to the Mira Voice AI Pipecat backend.
 *
 * All classroom endpoints live on the Pipecat server (e.g. http://localhost:7860)
 * under the /classroom prefix, NOT on the Open WebUI backend.
 */

export type ClassroomUser = {
	user_id: string;
	name: string;
	language: string;
	mode: 'text_and_audio' | 'text_only';
	is_speaker: boolean;
	is_teacher?: boolean;
};

export type HandRaise = {
	id: string;
	user_id: string;
	user_name: string;
	question_preview?: string;
	status: 'pending' | 'acknowledged' | 'dismissed';
	raised_at: number;
	resolved_at?: number;
};

export type ClassroomRoom = {
	room_id: string;
	name: string;
	created_at: number;
	user_count: number;
	users: ClassroomUser[];
	speaker_id: string | null;
	speaker_name: string | null;
	token_queue: string[];
	hand_raises: HandRaise[];
	active_session_id: string | null;
	topic: string | null;
	teacher_id: string | null;
	current_lesson_topic: string | null;
	room_type: 'teacher_driven' | 'discussion';
	curriculum_chapter_id: string | null;
	curriculum_section_id: string | null;
};

export type SessionRecord = {
	id: string;
	room_id: string;
	room_name: string;
	started_at: number;
	ended_at: number | null;
	speaker_ids: string[];
	participant_count: number;
	message_count: number;
	summary: string | null;
	quiz: QuizQuestion[] | null;
};

export type SessionMessage = {
	id: string;
	session_id: string;
	room_id: string;
	role: 'user' | 'assistant';
	speaker_id: string | null;
	speaker_name: string | null;
	content: string;
	original_language: string;
	translations: Record<string, string>;
	timestamp: number;
	reaction_counts: Record<string, number>;
};

export type QuizQuestion = {
	question: string;
	options: string[];
	correct: number;
	explanation: string;
};

export type DashboardStats = {
	total_sessions: number;
	total_messages: number;
	unique_participants: number;
	avg_session_duration_secs: number;
	total_hand_raises: number;
	total_reactions: number;
	recent_sessions: SessionRecord[];
};

export type ClassroomActor = {
	user_id: string;
	user_name?: string;
	user_email?: string;
	user_role?: string;
	/** OpenWebUI JWT — sent as Authorization: Bearer <token> to Pipecat */
	token?: string;
};

export type TeacherRoleRequest = {
	id: string;
	user_id: string;
	user_name: string;
	user_email: string;
	purpose?: string;
	status: 'pending' | 'approved' | 'rejected';
	created_at: number;
	reviewed_at?: number;
	reviewed_by?: string;
	review_note?: string;
};

/**
 * Get the OpenWebUI JWT from localStorage (if available).
 * This is sent as Authorization: Bearer <token> to Pipecat for JWT verification.
 */
export const getStoredToken = (): string | null => {
	try {
		return (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || null;
	} catch {
		return null;
	}
};

/** Default headers with optional JWT auth for anonymous / read-only endpoints. */
const defaultHeaders = (): HeadersInit => {
	const token = getStoredToken();
	return {
		Accept: 'application/json',
		...(token ? { Authorization: `Bearer ${token}` } : {})
	};
};

const actorHeaders = (actor?: ClassroomActor): HeadersInit => {
	const token = actor?.token || getStoredToken();
	if (!actor?.user_id) {
		return {
			Accept: 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		};
	}
	return {
		Accept: 'application/json',
		// JWT auth: send OpenWebUI token as Bearer for Pipecat to verify
		...(token ? { Authorization: `Bearer ${token}` } : {}),
		// Supplementary identity headers (display info, not verified by Pipecat)
		'x-user-id': actor.user_id,
		...(actor.user_name ? { 'x-user-name': actor.user_name } : {}),
		...(actor.user_email ? { 'x-user-email': actor.user_email } : {}),
		...(actor.user_role ? { 'x-user-role': actor.user_role } : {})
	};
};

// ── REST helpers ──────────────────────────────────────────────────

export const createRoom = async (
	baseUrl: string,
	name: string = 'Classroom',
	actorOrTeacherId?: ClassroomActor | string,
	opts?: {
		topic?: string;
		teacher_name?: string;
		is_permanent?: boolean;
		room_type?: string;
		curriculum_chapter_id?: string;
		curriculum_section_id?: string;
	}
): Promise<ClassroomRoom> => {
	const params = new URLSearchParams({ name });
	let actor: ClassroomActor | undefined;
	if (typeof actorOrTeacherId === 'string') {
		if (actorOrTeacherId) params.set('teacher_id', actorOrTeacherId);
	} else {
		actor = actorOrTeacherId;
	}
	if (opts?.topic) params.set('topic', opts.topic);
	if (opts?.teacher_name) params.set('teacher_name', opts.teacher_name);
	if (opts?.is_permanent) params.set('is_permanent', 'true');
	if (opts?.room_type) params.set('room_type', opts.room_type);
	if (opts?.curriculum_chapter_id) params.set('curriculum_chapter_id', opts.curriculum_chapter_id);
	if (opts?.curriculum_section_id) params.set('curriculum_section_id', opts.curriculum_section_id);

	const res = await fetch(`${baseUrl}/classroom/rooms?${params.toString()}`, {
		method: 'POST',
		headers: actorHeaders(actor)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Failed to create room');
	}
	return res.json();
};

export const listRooms = async (baseUrl: string): Promise<ClassroomRoom[]> => {
	const res = await fetch(`${baseUrl}/classroom/rooms`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Failed to list rooms');
	}
	const data = await res.json();
	return data.rooms || [];
};

export const getRoom = async (baseUrl: string, roomId: string): Promise<ClassroomRoom> => {
	const res = await fetch(`${baseUrl}/classroom/rooms/${roomId}`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Room not found');
	}
	return res.json();
};

export const updateRoom = async (
	baseUrl: string,
	roomId: string,
	opts: {
		name?: string;
		topic?: string;
		teacher_id?: string;
		is_permanent?: boolean;
		room_type?: string;
		curriculum_chapter_id?: string;
		curriculum_section_id?: string;
	}
): Promise<ClassroomRoom> => {
	const params = new URLSearchParams();
	if (opts.name) params.set('name', opts.name);
	if (opts.topic !== undefined) params.set('topic', opts.topic);
	if (opts.teacher_id) params.set('teacher_id', opts.teacher_id);
	if (opts.is_permanent !== undefined) params.set('is_permanent', String(opts.is_permanent));
	if (opts.room_type) params.set('room_type', opts.room_type);
	if (opts.curriculum_chapter_id) params.set('curriculum_chapter_id', opts.curriculum_chapter_id);
	if (opts.curriculum_section_id) params.set('curriculum_section_id', opts.curriculum_section_id);

	const res = await fetch(`${baseUrl}/classroom/rooms/${roomId}?${params.toString()}`, {
		method: 'PUT',
		headers: defaultHeaders()
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Failed to update room');
	}
	return res.json();
};

export type RoomMember = {
	user_id: string;
	display_name: string;
	language: string;
	role: string;
	mode: string;
	is_online: boolean;
	is_speaker: boolean;
	joined_at: number;
	last_active: number;
};

export const listRoomMembers = async (
	baseUrl: string,
	roomId: string
): Promise<{ members: RoomMember[]; online_count: number }> => {
	const res = await fetch(`${baseUrl}/classroom/rooms/${roomId}/members`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Failed to list members');
	}
	return res.json();
};

export const deleteRoom = async (baseUrl: string, roomId: string, actor?: ClassroomActor): Promise<void> => {
	const res = await fetch(`${baseUrl}/classroom/rooms/${roomId}`, {
		method: 'DELETE',
		headers: actorHeaders(actor)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Failed to delete room');
	}
};

export const manageToken = async (
	baseUrl: string,
	roomId: string,
	action: 'request' | 'pass' | 'release',
	userId: string,
	toUserId?: string
): Promise<{ granted?: boolean; speaker_id: string | null }> => {
	const params = new URLSearchParams({ action, user_id: userId });
	if (toUserId) params.set('to_user_id', toUserId);

	const res = await fetch(`${baseUrl}/classroom/rooms/${roomId}/token?${params.toString()}`, {
		method: 'POST',
		headers: defaultHeaders()
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Token action failed');
	}
	return res.json();
};

// ── Teacher role workflow ───────────────────────────────────────

export const getTeacherStatus = async (
	baseUrl: string,
	actor: ClassroomActor
): Promise<{ is_admin: boolean; is_teacher: boolean; latest_request: TeacherRoleRequest | null }> => {
	const res = await fetch(`${baseUrl}/classroom/teacher-status`, {
		method: 'GET',
		headers: actorHeaders(actor)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Failed to get teacher status');
	}
	return res.json();
};

export const requestTeacherRole = async (
	baseUrl: string,
	actor: ClassroomActor,
	purpose: string = ''
): Promise<TeacherRoleRequest> => {
	const params = new URLSearchParams();
	if (purpose.trim()) params.set('purpose', purpose.trim());
	const suffix = params.toString() ? `?${params.toString()}` : '';
	const res = await fetch(`${baseUrl}/classroom/teacher-requests${suffix}`, {
		method: 'POST',
		headers: actorHeaders(actor)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Failed to request teacher role');
	}
	return res.json();
};

export const listTeacherRoleRequests = async (
	baseUrl: string,
	actor: ClassroomActor,
	status?: 'pending' | 'approved' | 'rejected'
): Promise<TeacherRoleRequest[]> => {
	const params = new URLSearchParams();
	if (status) params.set('status', status);
	const suffix = params.toString() ? `?${params.toString()}` : '';
	const res = await fetch(`${baseUrl}/classroom/teacher-requests${suffix}`, {
		method: 'GET',
		headers: actorHeaders(actor)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'Failed to list teacher requests');
	}
	const data = await res.json();
	return data.requests || [];
};

export const reviewTeacherRoleRequest = async (
	baseUrl: string,
	actor: ClassroomActor,
	requestId: string,
	approved: boolean,
	note: string = ''
): Promise<TeacherRoleRequest> => {
	const action = approved ? 'approve' : 'reject';
	const params = new URLSearchParams();
	if (note.trim()) params.set('note', note.trim());
	const suffix = params.toString() ? `?${params.toString()}` : '';
	const res = await fetch(`${baseUrl}/classroom/teacher-requests/${requestId}/${action}${suffix}`, {
		method: 'POST',
		headers: actorHeaders(actor)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || `Failed to ${action} request`);
	}
	return res.json();
};

// ── Session History ───────────────────────────────────────────────

export const listSessions = async (
	baseUrl: string,
	roomId?: string,
	limit: number = 50,
	offset: number = 0
): Promise<SessionRecord[]> => {
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (roomId) params.set('room_id', roomId);

	const res = await fetch(`${baseUrl}/classroom/sessions?${params.toString()}`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) return [];
	const data = await res.json();
	return data.sessions || [];
};

export const getSession = async (
	baseUrl: string,
	sessionId: string
): Promise<{ session: SessionRecord; messages: SessionMessage[] }> => {
	const res = await fetch(`${baseUrl}/classroom/sessions/${sessionId}`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) {
		throw new Error('Session not found');
	}
	return res.json();
};

export const getSessionSummary = async (
	baseUrl: string,
	sessionId: string
): Promise<{ session_id: string; summary: string; key_concepts?: string[]; quiz?: QuizQuestion[] }> => {
	const res = await fetch(`${baseUrl}/classroom/sessions/${sessionId}/summary`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) {
		throw new Error('Failed to get session summary');
	}
	return res.json();
};

// ── Dashboard ─────────────────────────────────────────────────────

export const getDashboard = async (
	baseUrl: string,
	roomId?: string
): Promise<DashboardStats> => {
	const params = roomId ? `?room_id=${roomId}` : '';
	const res = await fetch(`${baseUrl}/classroom/dashboard${params}`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) {
		throw new Error('Failed to fetch dashboard');
	}
	return res.json();
};

// ── Curriculum ────────────────────────────────────────────────────

export type CurriculumFile = {
	filename: string;
	source: string;
	total_concepts: number;
	total_text_blocks: number;
	languages: string[];
};

export type CurriculumSection = {
	section_id: string;
	title: string;
	concepts: string[];
};

export type CurriculumChapter = {
	chapter_id: string;
	title: string;
	sections: CurriculumSection[];
};

export type CurriculumSearchResult = {
	concept_id: string;
	concept_name: string;
	chapter_ids: string[];
	occurrences: number;
};

export const listCurriculumFiles = async (
	baseUrl: string
): Promise<{ files: CurriculumFile[]; available: boolean }> => {
	const res = await fetch(`${baseUrl}/classroom/curriculum/files`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) return { files: [], available: false };
	return res.json();
};

export const getCurriculumTopics = async (
	baseUrl: string,
	filename?: string
): Promise<CurriculumChapter[]> => {
	const params = filename ? `?filename=${encodeURIComponent(filename)}` : '';
	const res = await fetch(`${baseUrl}/classroom/curriculum/topics${params}`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) return [];
	const data = await res.json();
	return data.tree || [];
};

export const searchCurriculumConcepts = async (
	baseUrl: string,
	query: string,
	limit: number = 20
): Promise<CurriculumSearchResult[]> => {
	const params = new URLSearchParams({ q: query, limit: String(limit) });
	const res = await fetch(`${baseUrl}/classroom/curriculum/search?${params.toString()}`, {
		method: 'GET',
		headers: defaultHeaders()
	});
	if (!res.ok) return [];
	const data = await res.json();
	return data.results || [];
};

export const getCurriculumContext = async (
	baseUrl: string,
	topic: string,
	maxTokens?: number,
	language: string = 'english'
): Promise<{ topic: string; context: string; char_count: number } | null> => {
	const params = new URLSearchParams({ language });
	if (maxTokens) params.set('max_tokens', String(maxTokens));
	const res = await fetch(
		`${baseUrl}/classroom/curriculum/context/${encodeURIComponent(topic)}?${params.toString()}`,
		{
			method: 'GET',
			headers: defaultHeaders()
		}
	);
	if (!res.ok) return null;
	return res.json();
};

// ── WebSocket URL builder ─────────────────────────────────────────

export const getClassroomWsUrl = (baseUrl: string, roomId: string): string => {
	// Convert http(s) to ws(s)
	const wsBase = baseUrl.replace(/^http/, 'ws');
	return `${wsBase}/classroom/rooms/${roomId}/ws`;
};
