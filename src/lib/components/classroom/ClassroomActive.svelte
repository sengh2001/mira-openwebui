<script lang="ts">
	import { createEventDispatcher, afterUpdate, getContext, onMount, onDestroy } from 'svelte';
	import type { ClassroomRoom, ClassroomUser } from '$lib/apis/classroom';
	import { getCurriculumTopics, listCurriculumFiles, type CurriculumChapter } from '$lib/apis/classroom';
	import type { ClassroomMessage } from '$lib/stores/classroom';

	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher();

	export let room: ClassroomRoom;
	export let self: { user_id: string; name: string; language: string; mode: string; is_speaker: boolean };
	export let messages: ClassroomMessage[] = [];
	export let isSpeaker = false;
	export let isTeacher = false;
	export let isHandRaised = false;
	export let topics: string[] = [];
	export let lessonTopic = '';
	export let error = '';
	export let pipecatBaseUrl = 'http://localhost:7860';

	// Speaker voice pipeline state (only relevant when isSpeaker && speakerMode === 'voice')
	export let speakerConnected = false;
	export let speakerListening = false;
	export let speakerError: string | null = null;
	export let speakerUserText = '';
	export let speakerBotText = '';

	// Speaker input mode: 'voice' = mic active, 'text' = text input
	export let speakerMode: 'voice' | 'text' = 'text';

	let messagesContainer: HTMLDivElement;
	let showUserPanel = false; // Hidden by default (especially on mobile); toggled via button
	// Auto-show on desktop
	let innerWidth = 0;
	$: if (innerWidth >= 640 && !showUserPanel) showUserPanel = true;
	let chatInput = '';
	let isSending = false;

	// Reaction picker state
	let showReactionPicker: string | null = null;
	const REACTION_EMOJIS = ['👍', '❤️', '😊', '🎉', '🤔', '💡'];

	// Teacher toolbar state
	let showTopicInput = false;
	let topicInputValue = '';

	// Curriculum topic picker state
	let curriculumTree: CurriculumChapter[] = [];
	let curriculumAvailable = false;
	let showCurriculumPicker = false;
	let expandedChapters: Set<string> = new Set();
	let expandedSections: Set<string> = new Set();

	// Chapter/Section dropdown state for teacher toolbar
	let activeChapterId = '';
	let activeSectionId = '';
	$: activeChapterObj = curriculumTree.find(c => c.chapter_id === activeChapterId);
	$: activeSectionObj = activeChapterObj?.sections.find(s => s.section_id === activeSectionId);

	// Load curriculum on mount and pre-populate dropdowns from room state
	onMount(async () => {
		try {
			const filesResult = await listCurriculumFiles(pipecatBaseUrl);
			curriculumAvailable = filesResult.available;
			if (curriculumAvailable) {
				curriculumTree = await getCurriculumTopics(pipecatBaseUrl);
				// Pre-populate dropdowns from room's saved curriculum IDs
				if (room.curriculum_chapter_id) activeChapterId = room.curriculum_chapter_id;
				if (room.curriculum_section_id) activeSectionId = room.curriculum_section_id;
			}
		} catch (e) {
			curriculumAvailable = false;
		}
	});

	function toggleCurrChapter(chapterId: string) {
		if (expandedChapters.has(chapterId)) {
			expandedChapters.delete(chapterId);
		} else {
			expandedChapters.add(chapterId);
		}
		expandedChapters = expandedChapters;
	}

	function toggleCurrSection(sectionId: string) {
		if (expandedSections.has(sectionId)) {
			expandedSections.delete(sectionId);
		} else {
			expandedSections.add(sectionId);
		}
		expandedSections = expandedSections;
	}

	function selectCurriculumTopic(concept: string) {
		topicInputValue = concept;
		showCurriculumPicker = false;
		// Auto-submit
		handleTeacherAction('SET_TOPIC', concept);
	}

	// Typing indicator: true when a streaming bot message is in progress
	$: isTyping = messages.length > 0 && messages[messages.length - 1]?._streaming === true;

	// Computed: students (non-teacher users)
	$: students = room.users.filter(u => u.user_id !== room.teacher_id);

	// ── Floating Reactions ─────────────────────────────────────────
	let floatingReactions: Array<{ id: number; emoji: string; x: number; y: number }> = [];
	let floatCounter = 0;

	function spawnFloatingReaction(emoji: string, event?: MouseEvent) {
		const x = event ? event.clientX : Math.random() * window.innerWidth * 0.6 + window.innerWidth * 0.2;
		const y = event ? event.clientY : window.innerHeight - 100;
		const id = ++floatCounter;
		floatingReactions = [...floatingReactions, { id, emoji, x, y }];
		setTimeout(() => {
			floatingReactions = floatingReactions.filter(r => r.id !== id);
		}, 2100);
	}

	// ── Toast Notifications ────────────────────────────────────────
	let toasts: Array<{ id: number; text: string; type: 'join' | 'leave' | 'info' }> = [];
	let toastCounter = 0;

	function showToast(text: string, type: 'join' | 'leave' | 'info' = 'info') {
		const id = ++toastCounter;
		toasts = [...toasts, { id, text, type }];
		setTimeout(() => {
			toasts = toasts.filter(t => t.id !== id);
		}, 2500);
	}

	// Track user joins/leaves for toasts
	let prevUserIds = new Set<string>();
	$: {
		const currentIds = new Set(room.users.map(u => u.user_id));
		// Detect joins
		for (const uid of currentIds) {
			if (!prevUserIds.has(uid) && prevUserIds.size > 0) {
				const user = room.users.find(u => u.user_id === uid);
				if (user && user.user_id !== self.user_id) {
					const lang = languageName(user.language);
					showToast(`${user.name} joined · ${lang}`, 'join');
				}
			}
		}
		// Detect leaves
		for (const uid of prevUserIds) {
			if (!currentIds.has(uid)) {
				showToast(`A user left the room`, 'leave');
			}
		}
		prevUserIds = currentIds;
	}

	function handleTeacherAction(action: string, payload: string = '') {
		dispatch('teacherAction', { action, payload });
		showTopicInput = false;
		topicInputValue = '';
	}

	// Auto-scroll to bottom when new messages arrive
	afterUpdate(() => {
		if (messagesContainer) {
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	});

	function languageFlag(code: string): string {
		const flags: Record<string, string> = {
			en: '🇬🇧',
			hi: '🇮🇳',
			ta: '🇮🇳'
		};
		return flags[code] || '🌐';
	}

	function languageName(code: string): string {
		const names: Record<string, string> = {
			en: 'English',
			hi: 'Hindi',
			ta: 'Tamil'
		};
		return names[code] || code;
	}

	function handleSendText() {
		if (!chatInput.trim() || isSending) return;
		const text = chatInput.trim();
		chatInput = '';
		isSending = true;
		dispatch('sendMessage', text);
		// isSending reset after bot responds (via message update)
		setTimeout(() => { isSending = false; }, 500);
	}

	function togglePlaybackMode() {
		const next = self.mode === 'text_and_audio' ? 'text_only' : 'text_and_audio';
		dispatch('setPlaybackMode', next);
	}

	function toggleMode() {
		const newMode = speakerMode === 'voice' ? 'text' : 'voice';
		dispatch('toggleMode', newMode);
	}

	function handleReaction(messageId: string, emoji: string, event?: MouseEvent) {
		dispatch('reaction', { messageId, emoji });
		showReactionPicker = null;
		// Spawn floating emoji
		spawnFloatingReaction(emoji, event);
	}

	function toggleReactionPicker(msgId: string) {
		showReactionPicker = showReactionPicker === msgId ? null : msgId;
	}

	// Generate a color for avatar based on user name
	function avatarColor(name: string, isTeacherUser: boolean, isSpeakerUser: boolean): string {
		if (isTeacherUser) return 'bg-amber-500 ring-2 ring-amber-300 dark:ring-amber-600';
		if (isSpeakerUser) return 'bg-green-500 ring-2 ring-green-300 dark:ring-green-600 mira-speaker-glow';
		const colors = [
			'bg-violet-500', 'bg-blue-500', 'bg-cyan-500', 'bg-emerald-500',
			'bg-rose-500', 'bg-orange-500', 'bg-teal-500', 'bg-indigo-500'
		];
		let hash = 0;
		for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
		return colors[Math.abs(hash) % colors.length];
	}

	// Determine if a message is from the teacher
	function isTeacherMessage(msg: ClassroomMessage): boolean {
		// Check by speaker_name matching teacher's name
		if (!room.teacher_id) return false;
		const teacher = room.users.find(u => u.user_id === room.teacher_id);
		return !!teacher && msg.speaker_name === teacher.name && msg.role === 'user';
	}
</script>

<svelte:window bind:innerWidth />

<!-- Floating Reactions -->
{#each floatingReactions as r (r.id)}
	<div
		class="mira-reaction-float"
		style="left: {r.x}px; top: {r.y}px;"
	>
		{r.emoji}
	</div>
{/each}

<!-- Toast Notifications -->
<div class="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
	{#each toasts as t (t.id)}
		<div
			class="mira-toast-enter pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg border text-sm font-medium
			{t.type === 'join'
				? 'bg-green-50 dark:bg-green-900/40 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
				: t.type === 'leave'
					? 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
					: 'bg-violet-50 dark:bg-violet-900/40 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300'}"
		>
			{#if t.type === 'join'}
				<span class="text-green-500">→</span>
			{:else if t.type === 'leave'}
				<span class="text-gray-400">←</span>
			{:else}
				<span class="text-violet-500">ℹ</span>
			{/if}
			{t.text}
		</div>
	{/each}
</div>

<div class="flex flex-col h-full bg-white dark:bg-gray-900">
	<!-- Header Bar -->
	<div
		class="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 mira-frosted border-b border-gray-100 dark:border-gray-800 px-3 sm:px-4 py-2 sm:py-3"
	>
		<!-- Row 1: Room info + user panel toggle -->
		<div class="flex items-center justify-between gap-2">
			<!-- Left: Room info -->
			<div class="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
				<button
					class="p-1 sm:p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 mira-transition text-gray-500 shrink-0"
					on:click={() => dispatch('leave')}
					title="Leave room"
				>
					<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
					</svg>
				</button>

				<div
					class="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white text-sm shadow-md shrink-0"
				>
					🏫
				</div>

				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5">
						<h2 class="text-xs sm:text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
							{room.name}
						</h2>
						{#if room.room_type === 'discussion'}
							<span class="hidden sm:inline px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
								💬 Discussion
							</span>
						{/if}
					</div>
					<div class="hidden sm:flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
						<!-- Participant avatars -->
						<div class="flex items-center -space-x-1.5">
							{#each room.users.slice(0, 5) as u (u.user_id)}
								<div
									class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border-2 border-white dark:border-gray-900 text-white mira-transition
									{avatarColor(u.name, u.user_id === room.teacher_id, u.is_speaker)}"
									title="{u.name}{u.user_id === room.teacher_id ? ' 🎓 Teacher' : ''}{u.is_speaker ? ' 🎤 Speaking' : ''}{u.user_id === self.user_id ? ' (you)' : ''}"
								>
									{u.name.charAt(0).toUpperCase()}
								</div>
							{/each}
							{#if room.users.length > 5}
								<div class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-500 border-2 border-white dark:border-gray-900">
									+{room.users.length - 5}
								</div>
							{/if}
						</div>
						<span>{room.user_count} user{room.user_count !== 1 ? 's' : ''}</span>
						{#if room.speaker_name}
							{@const speakerIsTeacher = room.speaker_id && room.speaker_id === room.teacher_id}
							<span class="text-gray-300 dark:text-gray-600">·</span>
							<span class="{speakerIsTeacher ? 'text-violet-600 dark:text-violet-400 font-medium' : 'text-green-600 dark:text-green-400'} flex items-center gap-1">
								<span class="relative flex h-2 w-2">
									<span class="animate-ping absolute inline-flex h-full w-full rounded-full {speakerIsTeacher ? 'bg-violet-400' : 'bg-green-400'} opacity-75"></span>
									<span class="relative inline-flex rounded-full h-2 w-2 {speakerIsTeacher ? 'bg-violet-500' : 'bg-green-500'}"></span>
								</span>
								{#if speakerIsTeacher}
									🎓 Teacher
								{:else}
									{room.speaker_name}
								{/if}
							</span>
							{#if room.user_count > 1}
								<span class="text-gray-300 dark:text-gray-600">·</span>
								<span class="text-blue-500 dark:text-blue-400 flex items-center gap-1">
									👥 {room.user_count - 1} listening
								</span>
							{/if}
						{/if}
					</div>
					<!-- Mobile: compact info line -->
					<div class="flex sm:hidden items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
						<span>{room.user_count} user{room.user_count !== 1 ? 's' : ''}</span>
						{#if room.speaker_name}
							<span class="text-gray-300">·</span>
							<span class="text-green-600 dark:text-green-400 truncate">🎙️ {room.speaker_name}</span>
						{/if}
					</div>
				</div>
			</div>

			<!-- Right: Compact actions -->
			<div class="flex items-center gap-1 sm:gap-2 shrink-0">
				<!-- Teacher badge (hidden on mobile) -->
				{#if isTeacher}
					<div class="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-100 to-amber-50 dark:from-amber-900/40 dark:to-amber-900/20 text-amber-700 dark:text-amber-300 text-xs font-medium border border-amber-200/50 dark:border-amber-700/30 shadow-sm">
						🎓 Teacher
					</div>
				{/if}

				<!-- Token controls -->
			{#if isSpeaker}
				<!-- Desktop: full badge -->
				<div class="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs font-semibold shadow-md mira-speaker-glow">
					<span class="text-sm">🎙️</span>
					<span class="relative flex h-2 w-2">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60"></span>
						<span class="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
					</span>
					You have the mic
				</div>
				<!-- Mobile: compact mic indicator -->
				<div class="flex sm:hidden items-center gap-1 px-2 py-1 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 text-white text-[10px] font-semibold shadow-md">
					🎙️
					<span class="relative flex h-1.5 w-1.5">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60"></span>
						<span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
					</span>
				</div>
				<button
					class="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 mira-transition border border-amber-200/50 dark:border-amber-700/30 whitespace-nowrap"
					on:click={() => dispatch('releaseToken')}
				>
					🎤 <span class="hidden sm:inline">Release Mic</span><span class="sm:hidden">Release</span>
				</button>
			{:else}
				{#if room.speaker_name}
					<div class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs font-medium border border-gray-200/50 dark:border-gray-700/30">
						<svg class="w-3 h-3 opacity-50" fill="currentColor" viewBox="0 0 20 20">
							<path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
						</svg>
						Waiting...
					</div>
				{/if}
				<button
					class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-medium bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 mira-transition border border-violet-200/50 dark:border-violet-700/30 whitespace-nowrap"
					on:click={() => dispatch('requestToken')}
				>
					<svg class="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
					</svg>
					<span class="hidden sm:inline">Request Mic</span><span class="sm:hidden">Mic</span>
				</button>
			{/if}

				<!-- Exit (desktop only) -->
				<button
					class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/30 mira-transition border border-rose-200/50 dark:border-rose-700/30"
					on:click={() => dispatch('leave')}
					title="Exit classroom"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m-7.5-3h13.5m0 0l-3.75-3.75M21.75 12l-3.75 3.75" />
					</svg>
					Exit Classroom
				</button>
				<!-- User panel toggle -->
				<button
					class="p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 mira-transition text-gray-500 relative shrink-0"
					on:click={() => (showUserPanel = !showUserPanel)}
					title="Users"
				>
					<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
						<path
							d="M10 9a3 3 0 100-6 3 3 0 000 6zM6 8a2 2 0 11-4 0 2 2 0 014 0zM1.49 15.326a.78.78 0 01-.358-.442 3 3 0 014.308-3.516 6.484 6.484 0 00-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 01-2.07-.655zM16.44 15.98a4.97 4.97 0 002.07-.654.78.78 0 00.357-.442 3 3 0 00-4.308-3.517 6.484 6.484 0 011.907 3.96 2.32 2.32 0 01-.026.654zM18 8a2 2 0 11-4 0 2 2 0 014 0zM5.304 16.19a.844.844 0 01-.277-.71 5 5 0 019.947 0 .843.843 0 01-.277.71A6.975 6.975 0 0110 18a6.974 6.974 0 01-4.696-1.81z"
						/>
					</svg>
					<span class="absolute -top-0.5 -right-0.5 bg-violet-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold shadow-sm">
						{room.user_count}
					</span>
				</button>
			</div>
		</div>
	</div>

	<!-- Teacher Lesson Toolbar (only visible to teacher) -->
	{#if isTeacher && isSpeaker}
		<div class="border-b border-indigo-100 dark:border-indigo-900/50 bg-gradient-to-r from-indigo-50 via-violet-50 to-indigo-50 dark:from-indigo-950/20 dark:via-violet-950/20 dark:to-indigo-950/20 px-3 sm:px-4 py-2">
			<div class="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none">
				<!-- Current lesson topic indicator -->
				{#if lessonTopic}
					<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/70 dark:bg-gray-800/50 text-xs text-indigo-700 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 mr-1 shadow-sm">
						📚 <span class="font-medium truncate max-w-[150px]">{lessonTopic}</span>
					</div>
				{/if}

				<!-- Set Topic — Chapter/Section dropdowns + free-text fallback -->
				{#if showTopicInput}
					<div class="flex flex-col gap-1.5 flex-1">
						{#if curriculumAvailable && curriculumTree.length > 0}
							<!-- Chapter / Section dropdown row -->
							<div class="flex items-center gap-1.5 flex-wrap">
								<select
									class="px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 mira-transition max-w-[180px]"
									bind:value={activeChapterId}
									on:change={() => {
										activeSectionId = '';
										const ch = curriculumTree.find(c => c.chapter_id === activeChapterId);
										if (ch && ch.sections.length > 0) {
											activeSectionId = ch.sections[0].section_id;
										}
									}}
									aria-label="Select chapter"
								>
									<option value="">📘 Chapter...</option>
									{#each curriculumTree as ch}
										<option value={ch.chapter_id}>{ch.title}</option>
									{/each}
								</select>

								<select
									class="px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 mira-transition max-w-[200px]"
									bind:value={activeSectionId}
									disabled={!activeChapterId}
									aria-label="Select section"
								>
									<option value="">📄 Section...</option>
									{#if activeChapterObj}
										{#each activeChapterObj.sections as sec}
											<option value={sec.section_id}>{sec.title}</option>
										{/each}
									{/if}
								</select>

								<button
									type="button"
									disabled={!activeSectionId}
									class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 mira-transition shadow-sm"
									on:click={() => {
										if (activeChapterObj && activeSectionObj) {
											const topic = `${activeChapterObj.title}: ${activeSectionObj.title}`;
											topicInputValue = topic;
											handleTeacherAction('SET_TOPIC', topic);
											dispatch('updateCurriculum', {
												curriculum_chapter_id: activeChapterId,
												curriculum_section_id: activeSectionId
											});
										}
									}}
								>
									Set
								</button>
								<button type="button" on:click={() => { showTopicInput = false; topicInputValue = ''; }}
									class="px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 mira-transition">
									✕
								</button>
							</div>
							<!-- Show concepts for selected section -->
							{#if activeSectionObj && activeSectionObj.concepts.length > 0}
								<div class="flex flex-wrap gap-1 ml-0.5">
									<span class="text-[9px] text-gray-400">Concepts:</span>
									{#each activeSectionObj.concepts as concept}
										<span class="px-1.5 py-0.5 rounded text-[9px] bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border border-violet-200/50 dark:border-violet-800/30">
											{concept}
										</span>
									{/each}
								</div>
							{/if}
						{:else}
							<!-- Fallback: free-text topic input when no curriculum loaded -->
							<form
								class="flex items-center gap-1.5"
								on:submit|preventDefault={() => {
									if (topicInputValue.trim()) handleTeacherAction('SET_TOPIC', topicInputValue.trim());
								}}
							>
								<input
									type="text"
									bind:value={topicInputValue}
									placeholder="Enter lesson topic..."
									class="flex-1 px-3 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 mira-transition"
									autofocus
								/>
								<button type="submit" disabled={!topicInputValue.trim()}
									class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 mira-transition shadow-sm">
									Set
								</button>
								<button type="button" on:click={() => { showTopicInput = false; topicInputValue = ''; }}
									class="px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 mira-transition">
									✕
								</button>
							</form>
						{/if}
					</div>
				{:else}
				<button
					class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 border border-blue-200/50 dark:border-blue-800/30 mira-transition shadow-sm whitespace-nowrap shrink-0"
					on:click={() => { showTopicInput = true; }}
					title="Set the lesson topic"
				>
					📝 <span class="hidden sm:inline">Set </span>Topic
				</button>

				<button
					class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200/50 dark:border-amber-800/30 mira-transition shadow-sm whitespace-nowrap shrink-0"
					on:click={() => handleTeacherAction('QUIZ')}
					title="Generate a quiz on recent material"
				>
					❓ Quiz
				</button>

				<button
					class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200/50 dark:border-emerald-800/30 mira-transition shadow-sm whitespace-nowrap shrink-0"
					on:click={() => handleTeacherAction('SUMMARIZE')}
					title="Summarize the lesson so far"
				>
					📋 <span class="hidden xs:inline">Summarize</span><span class="xs:hidden">Sum</span>
				</button>

				<button
					class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 border border-violet-200/50 dark:border-violet-800/30 mira-transition shadow-sm whitespace-nowrap shrink-0"
					on:click={() => handleTeacherAction('SIMPLIFY')}
					title="Re-explain more simply"
				>
					🔄 Simplify
				</button>

				<button
					class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 border border-rose-200/50 dark:border-rose-800/30 mira-transition shadow-sm whitespace-nowrap shrink-0"
					on:click={() => handleTeacherAction('NEXT')}
					title="Move to the next subtopic"
				>
					⏭️ Next
				</button>
				{/if}
			</div>
		</div>
	{:else if lessonTopic}
		<!-- Non-teacher users see the frosted topic banner -->
		<div class="border-b border-indigo-100 dark:border-indigo-900/50 mira-frosted px-4 py-2.5 mira-msg-enter">
			<div class="flex items-center gap-2.5 text-xs text-indigo-700 dark:text-indigo-300">
				<div class="flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 mira-breathe">
					📚
				</div>
				<span class="font-medium">Lesson: {lessonTopic}</span>
				{#if room.speaker_name}
					<span class="text-gray-400 dark:text-gray-500">· set by {room.speaker_id && room.speaker_id === room.teacher_id ? 'Teacher' : room.speaker_name}</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Main content area -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Messages -->
		<div class="flex-1 flex flex-col overflow-hidden">
			{#if error}
				<div class="mx-4 mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs mira-msg-enter">
					{error}
				</div>
			{/if}

			<!-- Chat messages -->
			<div class="flex-1 overflow-y-auto px-4 py-4 space-y-3" bind:this={messagesContainer}>
				{#if messages.length === 0}
					<div class="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500">
						<div class="w-16 h-16 rounded-2xl mira-gradient flex items-center justify-center mb-4 shadow-lg mira-breathe">
							<span class="text-2xl">🎓</span>
						</div>
						<p class="text-sm font-medium text-gray-600 dark:text-gray-300">Waiting for conversation...</p>
						<p class="text-xs mt-1 text-gray-400 dark:text-gray-500">
							{#if isSpeaker}
								{#if speakerMode === 'voice'}
									You have the speaker token — start talking to Mira!
								{:else}
									You have the speaker token — type your question below
								{/if}
							{:else if room.speaker_name}
								{#if room.speaker_id && room.speaker_id === room.teacher_id}
									The Teacher is speaking
								{:else}
									{room.speaker_name} is speaking
								{/if}
							{:else}
								Request the speaker token to talk to Mira
							{/if}
						</p>
					</div>
				{:else}
					{#each messages as msg, idx (msg.id)}
						<div class="flex {msg.role === 'assistant' ? '' : 'justify-end'} group relative mira-msg-enter" style="animation-delay: {Math.min(idx * 30, 300)}ms">
							<!-- Avatar for assistant messages -->
							{#if msg.role === 'assistant'}
								<div class="flex-shrink-0 mr-2 self-end">
									<div class="w-7 h-7 rounded-full mira-gradient flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
										M
									</div>
								</div>
							{/if}

							<div
								class="max-w-[85%] sm:max-w-[75%] px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-sm leading-relaxed mira-transition
								{msg.role === 'assistant'
									? 'mira-ai-bubble text-gray-900 dark:text-gray-100 rounded-bl-md shadow-sm'
									: isTeacherMessage(msg)
										? 'bg-violet-600 text-white rounded-br-md shadow-sm mira-teacher-bubble'
										: 'bg-violet-600 text-white rounded-br-md shadow-sm'}"
							>
								{#if msg.role === 'assistant' && msg.speaker_name}
									<div class="text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1 text-violet-600 dark:text-violet-400">
										<span class="mira-gradient-text">Mira</span>
										{#if msg.translated}
											<span class="mira-translation-badge ml-1">🌐 Translated to {languageName(self.language)}</span>
										{/if}
									</div>
								{:else if msg.translated}
									<div class="mb-1">
										<span class="mira-translation-badge">🌐 Translated to {languageName(self.language)}</span>
									</div>
								{/if}
								{msg.content}

								<!-- Reaction counts -->
								{#if msg.reaction_counts && Object.keys(msg.reaction_counts).length > 0}
									<div class="flex flex-wrap gap-1 mt-1.5">
										{#each Object.entries(msg.reaction_counts) as [emoji, count]}
											<button
												class="px-1.5 py-0.5 rounded-full text-[10px] mira-transition
												{msg.role === 'assistant'
													? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
													: 'bg-violet-500/50 hover:bg-violet-500/70'}"
												on:click={(e) => handleReaction(msg.db_message_id || msg.id, emoji, e)}
											>
												{emoji} {count}
											</button>
										{/each}
									</div>
								{/if}
							</div>

							<!-- User avatar for user messages -->
							{#if msg.role !== 'assistant'}
								<div class="flex-shrink-0 ml-2 self-end">
									<div
										class="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm
										{isTeacherMessage(msg) ? 'bg-amber-500' : 'bg-violet-500'}"
									>
										{(msg.speaker_name || '?').charAt(0).toUpperCase()}
									</div>
								</div>
							{/if}

							<!-- Reaction add button (on hover) -->
							<button
								class="opacity-0 group-hover:opacity-100 mira-transition self-end p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 text-xs ml-1"
								on:click={() => toggleReactionPicker(msg.id)}
								title="React"
							>
								😊
							</button>

							<!-- Reaction picker popup -->
							{#if showReactionPicker === msg.id}
								<div class="absolute {msg.role === 'assistant' ? 'left-0 ml-2' : 'right-0 mr-2'} bottom-full mb-1 z-20 flex gap-0.5 px-2 py-1.5 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 mira-msg-enter">
									{#each REACTION_EMOJIS as emoji}
										<button
											class="w-7 h-7 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center text-sm mira-transition hover:scale-125"
											on:click={(e) => handleReaction(msg.db_message_id || msg.id, emoji, e)}
										>
											{emoji}
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/each}

					<!-- Live streaming indicators -->
					{#if isSpeaker && speakerMode === 'voice'}
					{#if speakerUserText}
							<div class="flex justify-end mira-msg-enter">
								<div class="max-w-[85%] sm:max-w-[75%] px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-sm leading-relaxed bg-violet-400/60 text-white rounded-br-md italic shadow-sm">
									{speakerUserText}
									<span class="inline-block w-1 h-4 bg-white/60 animate-pulse ml-0.5"></span>
								</div>
							</div>
						{/if}
						{#if speakerBotText && !speakerUserText}
							<div class="flex mira-msg-enter">
								<div class="flex-shrink-0 mr-2 self-end">
									<div class="w-7 h-7 rounded-full mira-gradient flex items-center justify-center text-white text-[10px] font-bold shadow-sm mira-glow">
										M
									</div>
								</div>
								<div class="max-w-[85%] sm:max-w-[75%] px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-sm leading-relaxed mira-ai-bubble text-gray-900 dark:text-gray-100 rounded-bl-md shadow-sm">
									<div class="text-[10px] font-semibold uppercase tracking-wider mb-1 mira-gradient-text">
										Mira
									</div>
									{speakerBotText}
									<span class="inline-block w-1 h-4 bg-violet-500/60 animate-pulse ml-0.5"></span>
								</div>
							</div>
						{/if}
					{/if}

					<!-- Typing indicator (Mira is thinking) -->
					{#if isTyping}
						<div class="flex items-center gap-2 px-2 py-1 mira-msg-enter">
							<div class="w-6 h-6 rounded-full mira-gradient flex items-center justify-center text-white text-[9px] font-bold shadow-sm mira-breathe">
								M
							</div>
							<div class="flex items-center gap-1 px-3 py-2 rounded-2xl bg-gray-100 dark:bg-gray-800 rounded-bl-md">
								<span class="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
								<span class="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
								<span class="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
							</div>
							<span class="text-[10px] text-gray-400 dark:text-gray-500 italic">Mira is thinking...</span>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Bottom input area -->
			{#if isSpeaker}
				<!-- Mode toggle + input area -->
				<div class="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
					<!-- Voice/Text mode toggle bar -->
					<div class="px-4 pt-3 pb-1 flex items-center justify-between">
						<div class="flex items-center gap-1 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800">
							<button
								class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium mira-transition
								{speakerMode === 'voice'
									? 'bg-white dark:bg-gray-700 text-green-700 dark:text-green-400 shadow-sm'
									: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}"
								on:click={() => { if (speakerMode !== 'voice') toggleMode(); }}
							>
								<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
									<path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
								</svg>
								Voice
							</button>
							<button
								class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium mira-transition
								{speakerMode === 'text'
									? 'bg-white dark:bg-gray-700 text-violet-700 dark:text-violet-400 shadow-sm'
									: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}"
								on:click={() => { if (speakerMode !== 'text') toggleMode(); }}
							>
								<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
								</svg>
								Text
							</button>
						</div>

						{#if speakerMode === 'voice'}
							<!-- Voice status -->
							<div class="flex items-center gap-2 text-xs">
								{#if speakerListening}
									<span class="flex items-center gap-1.5 text-green-600 dark:text-green-400">
										<span class="relative flex h-2.5 w-2.5">
											<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
											<span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
										</span>
										Listening...
									</span>
								{:else if speakerConnected}
									<span class="text-amber-500">Connected</span>
								{:else}
									<span class="text-violet-500 dark:text-violet-400 flex items-center gap-1.5 font-medium">
										<span class="relative flex h-3 w-3">
											<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
											<span class="relative inline-flex rounded-full h-3 w-3 bg-violet-500"></span>
										</span>
										Connecting...
									</span>
								{/if}
								{#if speakerError}
									<span class="text-red-500 truncate max-w-[150px]">{speakerError}</span>
								{/if}
							</div>
						{/if}
					</div>

					<!-- Voice mode: mic status bar -->
					{#if speakerMode === 'voice'}
						<div class="px-4 py-3">
							<div class="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-green-50 via-emerald-50 to-green-50 dark:from-green-950/20 dark:via-emerald-950/20 dark:to-green-950/20 border border-green-200/50 dark:border-green-800/30 shadow-sm">
								{#if speakerListening}
									<div class="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shrink-0 mira-speaker-glow">
										<svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
											<path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
										</svg>
									</div>
								{:else}
									<div class="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center shrink-0 mira-breathe">
										<svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
											<path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
										</svg>
									</div>
								{/if}
								<div class="flex-1 min-w-0">
									<p class="text-sm text-gray-600 dark:text-gray-300">
										{#if speakerListening}
											Speak to Mira — your conversation will be broadcast to all listeners
										{:else}
											Connecting to Mira's voice pipeline...
										{/if}
									</p>
								</div>
							</div>
						</div>

					<!-- Text mode: text input -->
					{:else}
						<div class="px-4 py-3">
							<form
								class="flex items-center gap-2"
								on:submit|preventDefault={handleSendText}
							>
								<div class="flex-1 relative">
									<input
										type="text"
										bind:value={chatInput}
										placeholder="Type your question to Mira..."
										class="w-full px-4 py-2.5 rounded-xl text-sm bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/40 mira-transition"
										disabled={isSending}
									/>
								</div>
								<button
									type="submit"
									disabled={!chatInput.trim() || isSending}
									class="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white mira-transition shadow-sm"
								>
									{#if isSending}
										<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
									{:else}
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
										</svg>
									{/if}
								</button>
							</form>
						</div>
					{/if}
				</div>

		{:else}
			<!-- Listener bottom bar -->
			<div class="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
				<!-- Listener mode toggle bar (Text Only / Text + Audio) -->
				<div class="px-4 pt-3 pb-1 flex items-center justify-between">
					<div class="flex items-center gap-1 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800">
						<button
							class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium mira-transition
							{self.mode === 'text_only'
								? 'bg-white dark:bg-gray-700 text-violet-700 dark:text-violet-400 shadow-sm'
								: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}"
							on:click={() => { if (self.mode !== 'text_only') togglePlaybackMode(); }}
						>
							<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
							</svg>
							Text Only
						</button>
						<button
							class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium mira-transition
							{self.mode === 'text_and_audio'
								? 'bg-white dark:bg-gray-700 text-green-700 dark:text-green-400 shadow-sm'
								: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}"
							on:click={() => { if (self.mode !== 'text_and_audio') togglePlaybackMode(); }}
						>
							<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
								<path d="M10 3.75a.75.75 0 01.75.75v7.5a.75.75 0 01-1.5 0v-7.5a.75.75 0 01.75-.75z" />
								<path d="M5.5 8.5a4.5 4.5 0 109 0v3a4.5 4.5 0 11-9 0v-3z" />
								<path d="M3.5 8.5a.75.75 0 011.5 0v3a5 5 0 0010 0v-3a.75.75 0 011.5 0v3a6.5 6.5 0 01-5.75 6.454V20h2.5a.75.75 0 010 1.5h-6.5a.75.75 0 010-1.5h2.5v-2.046A6.5 6.5 0 013.5 11.5v-3z" />
							</svg>
							Text + Audio
						</button>
					</div>

					<!-- Hand raise button for listeners -->
					<button
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium mira-transition
						{isHandRaised
							? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700'
							: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600'}"
						on:click={() => isHandRaised ? dispatch('lowerHand') : dispatch('raiseHand', '')}
					>
						<span class={isHandRaised ? 'mira-hand-wave' : ''}>✋</span>
						{isHandRaised ? 'Lower Hand' : 'Raise Hand'}
					</button>
				</div>

				<!-- Listener status line -->
				<div class="px-4 pb-3 pt-1">
					<div class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
						</svg>
						{#if room.speaker_name}
							{@const listenerSpeakerIsTeacher = room.speaker_id && room.speaker_id === room.teacher_id}
							{#if listenerSpeakerIsTeacher}
								Listening to the Teacher's conversation with Mira
							{:else}
								Listening to {room.speaker_name}'s conversation with Mira
							{/if}
						{:else}
							No one is speaking — request the token to ask Mira a question
						{/if}
						{#if self.language !== 'en'}
							<span class="mira-translation-badge">
								🌐 {languageFlag(self.language)} {languageName(self.language)}
							</span>
						{/if}
					</div>
				</div>
			</div>
		{/if}

			<!-- Status bar -->
			<div class="px-3 sm:px-4 py-1.5 sm:py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
				<div class="flex items-center justify-between text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">
					<div class="flex items-center gap-1.5 sm:gap-2 min-w-0">
						<span class="flex items-center gap-1 shrink-0">
							{languageFlag(self.language)}
							<span class="hidden sm:inline">{languageName(self.language)}</span>
						</span>
						<span class="text-gray-300 dark:text-gray-600 hidden sm:inline">·</span>
						<span class="hidden sm:inline">{self.mode === 'text_and_audio' ? '🔊 Audio + Text' : '📝 Text Only'}</span>
					</div>
				<div class="flex items-center gap-2 sm:gap-3 shrink-0">
					<div class="flex items-center gap-1 sm:gap-1.5">
						<span
							class="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 {isSpeaker ? 'bg-green-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}"
						></span>
						{#if isTeacher && isSpeaker}
							<span class="hidden sm:inline">🎓 Teacher · Speaking</span>
							<span class="sm:hidden">🎓 Speaking</span>
						{:else if isTeacher}
							<span class="hidden sm:inline">🎓 Teacher · Listening</span>
							<span class="sm:hidden">🎓 Listening</span>
						{:else if isSpeaker}
							<span class="hidden sm:inline">You are the speaker</span>
							<span class="sm:hidden">Speaker</span>
						{:else}
							Listener
						{/if}
					</div>
					<span class="text-gray-300 dark:text-gray-600 hidden sm:inline">·</span>
					<span class="text-gray-400 dark:text-gray-500 italic hidden sm:inline">Powered by <span class="font-semibold mira-gradient-text">MIRA</span></span>
				</div>
				</div>
			</div>
		</div>

		<!-- User Panel (overlay on mobile, side panel on desktop) -->
		{#if showUserPanel}
			<!-- Mobile backdrop -->
			<!-- svelte-ignore a11y-click-events-have-key-events -->
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<div
				class="sm:hidden fixed inset-0 bg-black/30 z-30"
				on:click={() => (showUserPanel = false)}
			></div>
			<div
				class="fixed sm:relative right-0 top-0 bottom-0 z-40 sm:z-auto w-72 sm:w-64 border-l border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/90 sm:bg-gray-50/50 sm:dark:bg-gray-800/20 flex flex-col overflow-hidden shadow-xl sm:shadow-none"
			>
			<div class="p-4 border-b border-gray-100 dark:border-gray-800 space-y-3">
				<h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
					<span>Participants ({room.user_count})</span>
					{#if room.topic || room.current_lesson_topic}
						<span class="text-indigo-500 dark:text-indigo-400 font-normal normal-case truncate max-w-[120px]" title={room.topic || room.current_lesson_topic || ''}>
							📚 {room.topic || room.current_lesson_topic}
						</span>
					{/if}
				</h3>

				<!-- Your playback setting (listener: text-only vs text+audio) -->
				<div class="flex items-center justify-between">
					<div class="text-[11px] text-gray-500 dark:text-gray-400">Playback</div>
					<button
						class="px-2.5 py-1 rounded-lg text-[11px] font-medium mira-transition border
						{self.mode === 'text_and_audio'
							? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30'
							: 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/50'}"
						on:click={togglePlaybackMode}
						type="button"
					>
						{self.mode === 'text_and_audio' ? '🔊 Text + Audio' : '📝 Text Only'}
					</button>
				</div>
			</div>

			<!-- Teacher section -->
			{#each room.users.filter(u => u.user_id === room.teacher_id).slice(0, 1) as teacherUser}
				<div class="px-3 pt-3 pb-1">
					<div class="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1.5">Teacher</div>
					<div
						class="flex items-center gap-2.5 p-2.5 rounded-xl bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/30 dark:border-amber-800/20"
					>
						<div class="relative">
							<div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white bg-gradient-to-br from-amber-500 to-amber-600 shadow-sm ring-2 ring-amber-300 dark:ring-amber-700">
								{teacherUser.name.charAt(0).toUpperCase()}
							</div>
							{#if teacherUser.is_speaker}
								<div class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center">
									<svg class="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
										<path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
									</svg>
								</div>
							{/if}
							<div class="absolute -top-1 -right-1 text-xs">🎓</div>
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1">
								{teacherUser.name}
								{#if teacherUser.user_id === self.user_id}
									<span class="text-violet-500 text-[10px]">(you)</span>
								{/if}
							</div>
							<div class="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
								{languageFlag(teacherUser.language)} {languageName(teacherUser.language)}
								{#if teacherUser.is_speaker}
									<span class="text-green-600 dark:text-green-400 font-medium">· speaking</span>
								{/if}
							</div>
						</div>
						{#if isSpeaker && teacherUser.user_id !== self.user_id}
							<button
								class="p-1 rounded-md hover:bg-violet-100 dark:hover:bg-violet-900/30 text-violet-500 text-[10px] mira-transition"
								on:click={() => dispatch('passToken', teacherUser.user_id)}
								title="Pass mic to {teacherUser.name}"
							>
								🎤
							</button>
						{/if}
					</div>
				</div>
			{/each}

			<!-- Students section -->
			<div class="flex-1 overflow-y-auto p-3 space-y-1">
				{#if students.length > 0}
					<div class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
						Students ({students.length})
					</div>
				{/if}
				{#each students as u (u.user_id)}
					<div
						class="flex items-center gap-2.5 p-2.5 rounded-xl mira-transition group/user
						{u.user_id === self.user_id
							? 'bg-violet-50 dark:bg-violet-900/20 ring-1 ring-violet-200 dark:ring-violet-800'
							: 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
					>
						<div class="relative">
							<div
								class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white mira-transition
								{avatarColor(u.name, false, u.is_speaker)}"
							>
								{u.name.charAt(0).toUpperCase()}
							</div>
							{#if u.is_speaker}
								<div class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center">
									<svg class="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
										<path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
									</svg>
								</div>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-1">
								{u.name}
								{#if u.user_id === self.user_id}
									<span class="text-violet-500 text-[10px]">(you)</span>
								{/if}
							</div>
							<div class="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
								{languageFlag(u.language)} {languageName(u.language)}
								{#if u.is_speaker}
									<span class="text-green-600 dark:text-green-400 font-medium">· speaking</span>
								{/if}
							</div>
						</div>
						<!-- Teacher actions on students -->
						{#if u.user_id !== self.user_id}
							<div class="flex items-center gap-0.5 opacity-0 group-hover/user:opacity-100 mira-transition">
								{#if isSpeaker || isTeacher}
									<button
										class="p-1 rounded-md hover:bg-violet-100 dark:hover:bg-violet-900/30 text-violet-500 mira-transition"
										on:click={() => dispatch('passToken', u.user_id)}
										title="Pass mic to {u.name}"
										aria-label="Pass mic to {u.name}"
									>
										<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
										</svg>
									</button>
								{/if}
								{#if isTeacher}
									<button
										class="p-1 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-500 mira-transition"
										on:click={() => {
											if (confirm(`Make ${u.name} the teacher?`)) {
												dispatch('teacherAction', { action: 'PROMOTE_TEACHER', payload: u.user_id });
											}
										}}
										title="Make {u.name} teacher"
										aria-label="Make {u.name} teacher"
									>
										<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
										</svg>
									</button>
									<button
										class="p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-red-400 mira-transition"
										on:click={() => {
											if (confirm(`Remove ${u.name} from the room?`)) {
												dispatch('teacherAction', { action: 'KICK', payload: u.user_id });
											}
										}}
										title="Remove {u.name} from room"
										aria-label="Remove {u.name} from room"
									>
										<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
										</svg>
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
				{#if students.length === 0}
					<div class="flex flex-col items-center justify-center py-6 text-gray-400 dark:text-gray-500">
						<span class="text-2xl mb-2">👥</span>
						<p class="text-[10px]">No students yet</p>
						<p class="text-[10px]">Share the room link to invite</p>
					</div>
				{/if}
			</div>

				{#if room.hand_raises && room.hand_raises.filter(hr => hr.status === 'pending').length > 0}
					<div class="p-3 border-t border-gray-100 dark:border-gray-800">
						<h4 class="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1">
							<span class="mira-hand-wave">✋</span> Hands Raised ({room.hand_raises.filter(hr => hr.status === 'pending').length})
						</h4>
						<div class="space-y-1">
							{#each room.hand_raises.filter(hr => hr.status === 'pending') as hr, idx}
								<div class="flex items-center justify-between p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-800/30 mira-msg-enter">
									<div class="flex items-center gap-2 min-w-0">
										<span class="flex-shrink-0 w-5 h-5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-300 text-[10px] font-bold flex items-center justify-center">
											{idx + 1}
										</span>
										<div class="min-w-0">
										<div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
											{hr.user_name}
										</div>
										{#if hr.question_preview}
											<div class="text-[10px] text-gray-500 dark:text-gray-400 truncate">
												"{hr.question_preview}"
											</div>
										{/if}
									</div>
									</div>
									{#if isSpeaker}
										<div class="flex items-center gap-1 ml-2 shrink-0">
											<button
												class="p-1 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 mira-transition"
												on:click={() => dispatch('acknowledgeHand', hr.id)}
												title="Pass token to {hr.user_name}"
											>
												<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
													<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
												</svg>
											</button>
											<button
												class="p-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 mira-transition"
												on:click={() => dispatch('dismissHand', hr.id)}
												title="Dismiss"
											>
												<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
													<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
												</svg>
											</button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if room.token_queue && room.token_queue.length > 0}
					<div class="p-3 border-t border-gray-100 dark:border-gray-800">
						<h4 class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
							Token Queue
						</h4>
						{#each room.token_queue as queuedId, i}
							<div class="text-xs text-gray-600 dark:text-gray-400 py-0.5">
								{i + 1}. {room.users.find((u) => u.user_id === queuedId)?.name || queuedId}
							</div>
						{/each}
					</div>
				{/if}

				<!-- Topic Suggestions -->
				{#if isSpeaker}
					<div class="p-3 border-t border-gray-100 dark:border-gray-800">
						<div class="flex items-center justify-between mb-2">
							<h4 class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
								💡 Topics
							</h4>
							<button
								class="text-[10px] text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 mira-transition"
								on:click={() => dispatch('requestTopics')}
							>
								Refresh
							</button>
						</div>
						{#if topics.length > 0}
							<div class="space-y-1">
								{#each topics as topic}
									<button
										class="w-full text-left p-2 rounded-lg text-xs text-gray-700 dark:text-gray-300 bg-violet-50 dark:bg-violet-900/10 hover:bg-violet-100 dark:hover:bg-violet-900/20 border border-violet-100 dark:border-violet-800/30 mira-transition line-clamp-2"
										on:click={() => dispatch('selectTopic', topic)}
									>
										{topic}
									</button>
								{/each}
							</div>
						{:else}
							<p class="text-[10px] text-gray-400 dark:text-gray-500">
								Click refresh to get AI suggestions
							</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
