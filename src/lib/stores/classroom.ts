/**
 * Classroom Svelte stores.
 *
 * Manages: current room, user list, speaker state, messages,
 * hand raises, reactions, topics, and the WebSocket connection.
 */
import { writable, derived, get } from 'svelte/store';
import type { ClassroomRoom, ClassroomUser, HandRaise } from '$lib/apis/classroom';

// ── Types ─────────────────────────────────────────────────────────

export type ClassroomMessage = {
	id: string;
	role: 'user' | 'assistant';
	speaker_name?: string;
	content: string;
	translated?: boolean;
	timestamp: number;
	_streaming?: boolean;
	reaction_counts?: Record<string, number>;
	db_message_id?: string; // DB-persisted message ID for reactions
};

export type ClassroomState = 'lobby' | 'joining' | 'active' | 'history' | 'dashboard' | 'settings' | 'error';

// ── Stores ────────────────────────────────────────────────────────

/** Current view state */
export const classroomState = writable<ClassroomState>('lobby');

/** Room data from the server */
export const classroomRoom = writable<ClassroomRoom | null>(null);

/** Our own user in the room */
export const classroomSelf = writable<{
	user_id: string;
	name: string;
	language: string;
	mode: 'text_and_audio' | 'text_only';
	is_speaker: boolean;
} | null>(null);

/** All messages in the classroom conversation */
export const classroomMessages = writable<ClassroomMessage[]>([]);

/** The WebSocket instance for the classroom */
export const classroomWs = writable<WebSocket | null>(null);

/** Whether we are the current speaker */
export const isSpeaker = derived(
	[classroomRoom, classroomSelf],
	([$room, $self]) => {
		if (!$room || !$self) return false;
		return $room.speaker_id === $self.user_id;
	}
);

/** Whether we are the teacher of this room */
export const isTeacher = derived(
	[classroomRoom, classroomSelf],
	([$room, $self]) => {
		if (!$room || !$self) return false;
		return $room.teacher_id === $self.user_id;
	}
);

/** Error message if any */
export const classroomError = writable<string>('');

/** Topic suggestions from AI */
export const classroomTopics = writable<string[]>([]);

/** Whether our hand is currently raised */
export const isHandRaised = writable<boolean>(false);

/** Current lesson topic set by the teacher */
export const currentLessonTopic = writable<string>('');

// ── Actions ───────────────────────────────────────────────────────

let msgCounter = 0;

function genMsgId(): string {
	msgCounter++;
	return `cm-${Date.now()}-${msgCounter}`;
}

export function addClassroomMessage(
	role: 'user' | 'assistant',
	content: string,
	speakerName?: string,
	translated?: boolean,
	dbMessageId?: string
) {
	const msg: ClassroomMessage = {
		id: genMsgId(),
		role,
		speaker_name: speakerName,
		content,
		translated: translated ?? false,
		timestamp: Date.now(),
		reaction_counts: {},
		db_message_id: dbMessageId
	};
	classroomMessages.update((msgs) => [...msgs, msg]);
}

export function clearClassroomMessages() {
	classroomMessages.set([]);
}

export function updateMessageReaction(messageId: string, emoji: string, delta: number) {
	classroomMessages.update((msgs) =>
		msgs.map((m) => {
			if (m.id === messageId || m.db_message_id === messageId) {
				const counts = { ...(m.reaction_counts || {}) };
				counts[emoji] = Math.max(0, (counts[emoji] || 0) + delta);
				if (counts[emoji] === 0) delete counts[emoji];
				return { ...m, reaction_counts: counts };
			}
			return m;
		})
	);
}

export function resetClassroom() {
	classroomState.set('lobby');
	classroomRoom.set(null);
	classroomSelf.set(null);
	classroomMessages.set([]);
	classroomError.set('');
	classroomTopics.set([]);
	isHandRaised.set(false);
	currentLessonTopic.set('');

	// Close WS if open
	const ws = get(classroomWs);
	if (ws && ws.readyState <= WebSocket.OPEN) {
		ws.close();
	}
	classroomWs.set(null);
}
