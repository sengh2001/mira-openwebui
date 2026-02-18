<script lang="ts">
	import { createEventDispatcher, getContext, onMount } from 'svelte';
	import {
		listCurriculumFiles,
		getCurriculumTopics,
		type ClassroomRoom,
		type TeacherRoleRequest,
		type CurriculumChapter,
		type CurriculumFile
	} from '$lib/apis/classroom';
	import Spinner from '$lib/components/common/Spinner.svelte';

	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher();

	export let rooms: ClassroomRoom[] = [];
	export let loading = false;
	export let joining = false;
	export let error = '';
	export let pipecatBaseUrl = 'http://localhost:7860';

	export let userName = 'User';
	export let userLanguage = 'en';
	export let canCreateRooms = false;
	export let canDeleteRooms = false;
	export let actorUserId = '';
	export let isAdmin = false;
	export let teacherRequestPending = false;
	export let teacherRequests: TeacherRoleRequest[] = [];
	export let loadingTeacherRequests = false;
	export let classroomUserId = '';

	let showCreateForm = false;
	let newRoomName = '';
	let newRoomTopic = '';
	let newRoomPermanent = false;
	let newRoomType: 'teacher_driven' | 'discussion' = 'teacher_driven';
	let newCurriculumChapterId = '';
	let newCurriculumSectionId = '';
	let showTopicPicker = false;
	let teacherPurpose = '';
	let curriculumFiles: CurriculumFile[] = [];
	let curriculumTree: CurriculumChapter[] = [];
	let curriculumAvailable = false;
	let loadingCurriculum = false;

	$: selectedChapter = curriculumTree.find((c) => c.chapter_id === newCurriculumChapterId);
	$: selectedSection = selectedChapter?.sections.find((s) => s.section_id === newCurriculumSectionId);
	$: sectionConcepts = selectedSection?.concepts || [];

	onMount(async () => {
		try {
			loadingCurriculum = true;
			const filesResult = await listCurriculumFiles(pipecatBaseUrl);
			curriculumFiles = filesResult.files || [];
			curriculumAvailable = filesResult.available;
			if (curriculumAvailable) {
				curriculumTree = await getCurriculumTopics(pipecatBaseUrl);
			}
		} catch {
			curriculumAvailable = false;
			curriculumTree = [];
			curriculumFiles = [];
		} finally {
			loadingCurriculum = false;
		}
	});

	function suggestRoomName(): string {
		const now = new Date();
		const month = now.toLocaleString('default', { month: 'short' });
		const day = now.getDate();
		const hour = now.getHours();
		const period = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
		return `${period} Session · ${month} ${day}`;
	}

	function openCreateForm() {
		showCreateForm = true;
		if (!newRoomName.trim()) {
			newRoomName = suggestRoomName();
		}
	}

	function selectSection(chapter: CurriculumChapter, section: { section_id: string; title: string }) {
		newCurriculumChapterId = chapter.chapter_id;
		newCurriculumSectionId = section.section_id;
		newRoomTopic = `${chapter.title}: ${section.title}`;
		showTopicPicker = false;
	}

	const languages = [
		{ code: 'en', label: 'English' },
		{ code: 'hi', label: 'Hindi' },
		{ code: 'ta', label: 'Tamil' }
	];

	function handleCreate() {
		if (!newRoomName.trim()) return;
		dispatch('create', {
			name: newRoomName.trim(),
			topic: newRoomTopic.trim() || undefined,
			is_permanent: newRoomPermanent,
			room_type: newRoomType,
			curriculum_chapter_id: newCurriculumChapterId || undefined,
			curriculum_section_id: newCurriculumSectionId || undefined
		});
		newRoomName = '';
		newRoomTopic = '';
		newRoomPermanent = false;
	newRoomType = 'teacher_driven';
	newCurriculumChapterId = '';
	newCurriculumSectionId = '';
	showTopicPicker = false;
	showCreateForm = false;
}

	function submitTeacherRequest() {
		dispatch('requestTeacher', teacherPurpose.trim());
		teacherPurpose = '';
	}

	function formatTime(ts: number) {
		return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function canDeleteRoom(room: ClassroomRoom): boolean {
		if (!canDeleteRooms) return false;
		if (isAdmin) return true;
		return Boolean(room.teacher_id && actorUserId && room.teacher_id === actorUserId);
	}

	function isJoinSuppressedTarget(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		return Boolean(
			target.closest(
				'[data-no-join="true"], button, a, input, select, textarea, [contenteditable="true"]'
			)
		);
	}

	function handleCardClick(event: MouseEvent, roomId: string) {
		if (event.defaultPrevented || isJoinSuppressedTarget(event.target)) return;
		dispatch('join', roomId);
	}

	function handleCardKeydown(event: KeyboardEvent, roomId: string) {
		if (event.defaultPrevented || isJoinSuppressedTarget(event.target)) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			dispatch('join', roomId);
		}
	}

	// Generate avatar initials cluster colors
	function avatarColor(idx: number): string {
		const colors = [
			'bg-violet-500', 'bg-blue-500', 'bg-cyan-500', 'bg-emerald-500',
			'bg-rose-500', 'bg-orange-500', 'bg-teal-500', 'bg-indigo-500'
		];
		return colors[idx % colors.length];
	}
</script>

<div class="flex flex-col h-full">
	<!-- Header -->
	<div
		class="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 mira-frosted border-b border-gray-100 dark:border-gray-800 px-4 sm:px-6 py-3 sm:py-4"
	>
		<div class="max-w-5xl mx-auto space-y-2">
			<!-- Row 1: Title + Create button -->
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 sm:gap-3 min-w-0">
					<div
						class="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shrink-0"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="currentColor"
							class="w-4 h-4 sm:w-5 sm:h-5"
						>
							<path
								d="M11.7 2.805a.75.75 0 01.6 0A60.65 60.65 0 0122.83 8.72a.75.75 0 01-.231 1.337 49.949 49.949 0 00-9.902 3.912l-.003.002-.34.18a.75.75 0 01-.707 0A50.009 50.009 0 007.5 12.174v-.224c0-.131.067-.248.172-.311a54.614 54.614 0 014.653-2.52.75.75 0 00-.65-1.352 56.129 56.129 0 00-4.78 2.589 1.858 1.858 0 00-.859 1.228 49.803 49.803 0 00-4.634-1.527.75.75 0 01-.231-1.337A60.653 60.653 0 0111.7 2.805z"
							/>
							<path
								d="M13.06 15.473a48.45 48.45 0 017.666-3.282c.134 1.414.22 2.843.255 4.285a.75.75 0 01-.46.71 47.878 47.878 0 00-8.105 4.342.75.75 0 01-.832 0 47.205 47.205 0 00-1.346-.808c-.061-.036-.12-.073-.18-.11a48.657 48.657 0 00-8.003-3.817.75.75 0 01-.46-.71c.035-1.442.121-2.87.255-4.286A48.454 48.454 0 019.94 15.08l.04.021c.375.198.713.41 1.02.632z"
							/>
							<path
								d="M4.853 12.346a48.571 48.571 0 01-.194 3.697c.166.063.334.126.504.187a49.825 49.825 0 016.837 3.285V18.5a.75.75 0 011.5 0v.966a49.373 49.373 0 016.387-3.07l.953-.37c.062-1.282.1-2.571.115-3.867a50.413 50.413 0 00-5.755 2.13.75.75 0 01-.678 0A50.26 50.26 0 004.853 12.346z"
							/>
						</svg>
					</div>
					<div class="min-w-0">
						<h1 class="text-base sm:text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">Classroom</h1>
						<p class="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 truncate">
							Multi-user voice sessions with real-time translation
						</p>
					</div>
				</div>

				<button
					class="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-medium text-xs sm:text-sm hover:from-violet-700 hover:to-indigo-700 mira-transition shadow-md hover:shadow-lg shrink-0"
					disabled={!canCreateRooms}
					on:click={() => { showCreateForm ? showCreateForm = false : openCreateForm(); }}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="w-4 h-4"
					>
						<path
							d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z"
						/>
					</svg>
					<span class="hidden xs:inline">Create Room</span>
					<span class="xs:hidden">New</span>
				</button>
			</div>

			<!-- Row 2: Nav tabs (scrollable on mobile) -->
			<div class="flex items-center gap-1 overflow-x-auto scrollbar-none -mx-1 px-1">
				<button
					class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 mira-transition text-gray-500 text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0"
					on:click={() => dispatch('viewDashboard')}
					title="Teacher Dashboard"
				>
					<svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
					</svg>
					Dashboard
				</button>
				<button
					class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 mira-transition text-gray-500 text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0"
					on:click={() => dispatch('viewHistory')}
					title="Session History"
				>
					<svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
					</svg>
					History
				</button>
				<button
					class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 mira-transition text-gray-500 text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0"
					on:click={() => dispatch('viewSettings')}
					title="Room Settings"
				>
					<svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
					Settings
				</button>
				<button
					class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 mira-transition text-gray-500 text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0"
					on:click={() => dispatch('refresh')}
					title="Refresh rooms"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 {loading ? 'animate-spin' : ''}"
					>
						<path
							fill-rule="evenodd"
							d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.768a.75.75 0 00-.75.75v3.464a.75.75 0 001.5 0v-1.53l.232.232a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-1.924-5.288A7 7 0 001.676 9.274a.75.75 0 001.449.39 5.5 5.5 0 019.201-2.466l.312.311H10.206a.75.75 0 000 1.5h3.464a.75.75 0 00.75-.75V4.795a.75.75 0 00-1.5 0v1.53l-.232-.232a7.009 7.009 0 00-.3-.257z"
							clip-rule="evenodd"
						/>
					</svg>
					Refresh
				</button>
			</div>
		</div>
		{#if !canCreateRooms}
			<div class="max-w-4xl mx-auto mt-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
				{#if teacherRequestPending}
					Teacher role request is pending admin approval.
				{:else}
					Only approved teachers (or admins) can create/delete classrooms.
				{/if}
			</div>
		{/if}
	</div>

	<!-- Main Content -->
	<div class="flex-1 overflow-y-auto">
		<div class="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
			{#if error}
				<div
					class="flex items-center gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm mira-msg-enter"
				>
					<svg class="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
						<path
							fill-rule="evenodd"
							d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
							clip-rule="evenodd"
						/>
					</svg>
					{error}
				</div>
			{/if}

			<!-- Create Room Form (Enhanced) -->
			{#if showCreateForm && canCreateRooms}
			<div
				class="p-4 sm:p-5 rounded-2xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10 space-y-3 sm:space-y-4 mira-msg-enter"
			>
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
							Create a New Room
						</h3>
						<button
							class="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 mira-transition"
							on:click={() => (showCreateForm = false)}
							aria-label="Close create form"
						>
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div>
							<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Room Name *</label>
							<input
								type="text"
								class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400 mira-transition"
								placeholder="e.g. Physics Class"
								bind:value={newRoomName}
								on:keydown={(e) => e.key === 'Enter' && handleCreate()}
							/>
						</div>
						<div>
							<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Topic</label>
							<div class="flex gap-2">
								<input
									type="text"
									class="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400 mira-transition"
									placeholder="e.g. Solar System, Photosynthesis"
									bind:value={newRoomTopic}
								/>
								{#if curriculumAvailable}
									<button
										class="px-3 py-2 rounded-xl text-xs font-medium mira-transition
											{showTopicPicker
											? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700'
											: 'bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 hover:border-violet-300 hover:text-violet-600'}"
										on:click={() => {
											showTopicPicker = !showTopicPicker;
										}}
										title="Browse curriculum topics"
										aria-label="Browse curriculum topics"
									>
										📖
									</button>
								{/if}
							</div>
						</div>
					</div>

				<!-- Room Type Selector -->
				<div>
					<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Room Type</label>
					<div class="flex gap-2">
						<button
							class="flex-1 px-3 py-2 rounded-xl text-xs font-medium mira-transition border
								{newRoomType === 'teacher_driven'
								? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700'
								: 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:border-violet-300'}"
							on:click={() => { newRoomType = 'teacher_driven'; }}
						>
							🎓 Teacher Driven
							<span class="block text-[10px] mt-0.5 opacity-70">Teacher leads, AI assists</span>
						</button>
						<button
							class="flex-1 px-3 py-2 rounded-xl text-xs font-medium mira-transition border
								{newRoomType === 'discussion'
								? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
								: 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:border-emerald-300'}"
							on:click={() => { newRoomType = 'discussion'; }}
						>
							💬 Discussion
							<span class="block text-[10px] mt-0.5 opacity-70">Students discuss with AI</span>
						</button>
					</div>
				</div>

				<!-- Curriculum chapter/section picker -->
				{#if curriculumAvailable}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div>
							<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
								📘 Chapter
							</label>
							<select
								class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400 mira-transition"
								bind:value={newCurriculumChapterId}
								on:change={() => {
									newCurriculumSectionId = '';
									const chapter = curriculumTree.find((c) => c.chapter_id === newCurriculumChapterId);
									if (chapter && chapter.sections.length > 0) {
										newCurriculumSectionId = chapter.sections[0].section_id;
										newRoomTopic = `${chapter.title}: ${chapter.sections[0].title}`;
									}
								}}
							>
								<option value="">-- Select Chapter --</option>
								{#each curriculumTree as chapter}
									<option value={chapter.chapter_id}>{chapter.title}</option>
								{/each}
							</select>
						</div>
						<div>
							<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
								📄 Section (Topic)
							</label>
							<select
								class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400 mira-transition"
								bind:value={newCurriculumSectionId}
								disabled={!newCurriculumChapterId}
								on:change={() => {
									if (selectedChapter && newCurriculumSectionId) {
										const section = selectedChapter.sections.find(
											(s) => s.section_id === newCurriculumSectionId
										);
										if (section) {
											newRoomTopic = `${selectedChapter.title}: ${section.title}`;
										}
									}
								}}
							>
								<option value="">-- Select Section --</option>
								{#if selectedChapter}
									{#each selectedChapter.sections as section}
										<option value={section.section_id}>{section.title}</option>
									{/each}
								{/if}
							</select>
						</div>
					</div>
					{#if sectionConcepts.length > 0}
						<div class="flex flex-wrap gap-1.5 mt-1">
							<span class="text-[10px] text-gray-400 mr-1">Concepts:</span>
							{#each sectionConcepts as concept}
								<button
									class="px-2 py-0.5 rounded-lg text-[10px] bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border border-violet-200/50 dark:border-violet-800/30 hover:bg-violet-100 dark:hover:bg-violet-900/30 mira-transition"
									on:click={() => {
										newRoomTopic = concept;
										showTopicPicker = false;
									}}
								>
									{concept}
								</button>
							{/each}
						</div>
					{/if}
				{/if}

				{#if showTopicPicker && curriculumAvailable}
					<div
						class="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10 p-4 max-h-64 overflow-y-auto"
					>
						<div class="flex items-center justify-between mb-3">
							<h5 class="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider">
								📚 Browse All Topics
							</h5>
							<button
								class="text-[10px] text-gray-400 hover:text-gray-600"
								on:click={() => {
									showTopicPicker = false;
								}}
								aria-label="Close topic picker"
							>
								✕ close
							</button>
						</div>

						{#if loadingCurriculum}
							<div class="flex items-center justify-center py-4">
								<Spinner className="size-4" />
							</div>
						{:else if curriculumTree.length === 0}
							<p class="text-xs text-gray-400 italic">No curriculum data loaded</p>
						{:else}
							<div class="space-y-2">
								{#each curriculumTree as chapter}
									<div class="rounded-lg border border-violet-100 dark:border-violet-900/40 bg-white/70 dark:bg-gray-900/20 p-2">
										<div class="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
											📘 {chapter.title}
										</div>
										<div class="space-y-1">
											{#each chapter.sections as section}
												<button
													class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs mira-transition
														{newCurriculumSectionId === section.section_id
														? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium'
														: 'text-gray-600 dark:text-gray-400 hover:bg-violet-100/30 dark:hover:bg-violet-900/10'}"
													on:click={() => selectSection(chapter, section)}
													title="Set topic to {chapter.title}: {section.title}"
												>
													<span>📄 {section.title}</span>
													<span class="text-[9px] text-gray-400 ml-auto">{section.concepts.length} concepts</span>
												</button>
											{/each}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<div class="flex items-center gap-4">
					{#if curriculumAvailable}
						<span class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-xs border border-emerald-200/50 dark:border-emerald-800/30">
							📚 {curriculumFiles.length} curriculum file{curriculumFiles.length !== 1 ? 's' : ''} loaded
						</span>
					{/if}
					<label class="flex items-center gap-2 cursor-pointer group">
						<div class="relative">
							<input type="checkbox" bind:checked={newRoomPermanent} class="sr-only peer" />
							<div class="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer-checked:bg-violet-500 mira-transition"></div>
							<div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 mira-transition"></div>
						</div>
						<span class="text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 mira-transition">
							Permanent room
						</span>
					</label>
				</div>

					<div class="flex justify-end gap-2 pt-1">
						<button
							class="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 mira-transition"
							on:click={() => (showCreateForm = false)}
						>
							Cancel
						</button>
						<button
							class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium hover:from-violet-700 hover:to-indigo-700 mira-transition shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
							on:click={handleCreate}
							disabled={!newRoomName.trim()}
						>
							🏫 Create Room
						</button>
					</div>
				</div>
			{/if}

			<!-- Your Settings -->
		<div
			class="p-4 sm:p-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 space-y-3 sm:space-y-4"
		>
			<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
				Your Settings
			</h3>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
					<div>
						<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5"
							>Display Name</label
						>
						<input
							type="text"
							class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mira-transition"
							bind:value={userName}
						/>
					</div>
					<div>
						<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5"
							>Language</label
						>
						<select
							class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mira-transition"
							bind:value={userLanguage}
						>
							{#each languages as lang}
								<option value={lang.code}>{lang.label}</option>
							{/each}
						</select>
					</div>
				</div>
			</div>

			<!-- Teacher Access -->
		{#if !isAdmin}
			<div class="p-4 sm:p-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 space-y-3">
				<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
					Teacher Access
				</h3>
					{#if teacherRequestPending}
						<p class="text-xs text-amber-600 dark:text-amber-300">Request already submitted. Waiting for admin review.</p>
					{:else if canCreateRooms}
						<p class="text-xs text-emerald-600 dark:text-emerald-300">You are approved as a teacher.</p>
					{:else}
						<p class="text-xs text-gray-500 dark:text-gray-400">Submit a request to become a teacher.</p>
					<div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
						<input
							type="text"
							class="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mira-transition"
							placeholder="Optional note for admin"
							bind:value={teacherPurpose}
						/>
						<button
							class="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 mira-transition whitespace-nowrap shrink-0"
							on:click={submitTeacherRequest}
						>
							Request Role
						</button>
					</div>
					{/if}
				</div>
			{/if}

			<!-- Admin: Teacher requests panel -->
		{#if isAdmin}
			<div class="p-4 sm:p-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 space-y-3">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
							Teacher Role Requests
						</h3>
						<button
							class="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 mira-transition"
							on:click={() => dispatch('refreshTeacherRequests')}
						>
							Refresh
						</button>
					</div>

					{#if loadingTeacherRequests}
						<div class="py-4"><Spinner className="size-5" /></div>
					{:else if teacherRequests.length === 0}
						<p class="text-xs text-gray-500 dark:text-gray-400">No pending requests.</p>
					{:else}
						<div class="space-y-2">
							{#each teacherRequests as req}
								<div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
									<div class="text-sm font-medium text-gray-800 dark:text-gray-100">{req.user_name}</div>
									<div class="text-xs text-gray-500 dark:text-gray-400">{req.user_email || req.user_id}</div>
									{#if req.purpose}
										<div class="text-xs text-gray-600 dark:text-gray-300 mt-1">{req.purpose}</div>
									{/if}
									<div class="mt-2 flex gap-2">
										<button
											class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-700 mira-transition"
											on:click={() => dispatch('approveTeacherRequest', req.id)}
										>
											Approve
										</button>
										<button
											class="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs hover:bg-red-700 mira-transition"
											on:click={() => dispatch('rejectTeacherRequest', req.id)}
										>
											Reject
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Room List -->
			<div>
				<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">
					Available Rooms
				</h3>

				{#if loading}
					<div class="flex items-center justify-center py-16">
						<Spinner className="size-6" />
					</div>
				{:else if rooms.length === 0}
					<div
						class="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500"
					>
						<div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
							<svg class="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
								/>
							</svg>
						</div>
						<p class="text-sm font-medium text-gray-600 dark:text-gray-300">No rooms yet</p>
						<p class="text-xs mt-1">Create a room to get started</p>
							<button
								class="mt-4 px-4 py-2 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium hover:bg-violet-200 dark:hover:bg-violet-900/40 mira-transition"
								disabled={!canCreateRooms}
								on:click={openCreateForm}
							>
							+ Create your first room
						</button>
					</div>
				{:else}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{#each rooms as room}
							<div
								class="mira-room-card group p-4 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/50 hover:shadow-lg mira-transition cursor-pointer"
								on:click={(e) => handleCardClick(e, room.room_id)}
								on:keydown={(e) => handleCardKeydown(e, room.room_id)}
								role="button"
								tabindex="0"
							>
								<div class="flex items-start justify-between">
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2">
											<h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
												{room.name}
											</h4>
										{#if room.room_type === 'discussion'}
											<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
												💬 Discussion
											</span>
										{/if}
										{#if room.user_count > 0}
											<span class="mira-live-dot text-[10px] font-bold text-red-500 uppercase tracking-wider">
												Live
											</span>
										{/if}
										</div>
										{#if room.topic || room.current_lesson_topic}
											<p class="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5 truncate">
												📚 {room.topic || room.current_lesson_topic}
											</p>
										{/if}
										<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
											Room: {room.room_id}
										</p>
									</div>
									<div class="flex items-center gap-1">
										{#if canDeleteRoom(room)}
											<button
												type="button"
												data-no-join="true"
												class="relative z-20 p-1.5 rounded-lg opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 hover:text-red-600 mira-transition pointer-events-auto"
												on:mousedown|stopPropagation
												on:pointerdown|stopPropagation
												on:pointerup|stopPropagation
												on:keydown|stopPropagation
												on:click={(event) => {
													event.preventDefault();
													event.stopPropagation();
													dispatch('delete', room.room_id);
												}}
												title="Delete room"
												aria-label="Delete room"
											>
												<svg
													class="w-4 h-4"
													fill="none"
													viewBox="0 0 24 24"
													stroke="currentColor"
													stroke-width="1.5"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
													/>
												</svg>
											</button>
										{/if}
									</div>
								</div>

								<div class="flex items-center gap-4 mt-3">
									{#if room.users && room.users.length > 0}
										<div class="flex items-center -space-x-1.5">
											{#each room.users.slice(0, 4) as u, i}
												<div
													class="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-white dark:border-gray-800 {u.is_teacher ? 'bg-gradient-to-br from-violet-500 to-indigo-600' : avatarColor(i)}"
													title={u.is_teacher ? `${u.name} (Teacher)` : u.name}
												>
													{#if u.is_teacher}
														🎓
													{:else}
														{u.name.charAt(0).toUpperCase()}
													{/if}
												</div>
											{/each}
											{#if room.users.length > 4}
												<div class="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-500 border-2 border-white dark:border-gray-800">
													+{room.users.length - 4}
												</div>
											{/if}
										</div>
									{/if}

									<div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
										<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
											<path
												d="M10 9a3 3 0 100-6 3 3 0 000 6zM6 8a2 2 0 11-4 0 2 2 0 014 0zM1.49 15.326a.78.78 0 01-.358-.442 3 3 0 014.308-3.516 6.484 6.484 0 00-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 01-2.07-.655zM16.44 15.98a4.97 4.97 0 002.07-.654.78.78 0 00.357-.442 3 3 0 00-4.308-3.517 6.484 6.484 0 011.907 3.96 2.32 2.32 0 01-.026.654zM18 8a2 2 0 11-4 0 2 2 0 014 0zM5.304 16.19a.844.844 0 01-.277-.71 5 5 0 019.947 0 .843.843 0 01-.277.71A6.975 6.975 0 0110 18a6.974 6.974 0 01-4.696-1.81z"
											/>
										</svg>
										{room.user_count} {room.user_count === 1 ? 'user' : 'users'}
									</div>

									{#if room.speaker_name}
										{@const speakerUser = room.users?.find(u => u.is_speaker)}
										<div
											class="flex items-center gap-1.5 text-xs {speakerUser?.is_teacher ? 'text-violet-600 dark:text-violet-400 font-medium' : 'text-green-600 dark:text-green-400'}"
										>
											<span class="relative flex h-2 w-2">
												<span class="animate-ping absolute inline-flex h-full w-full rounded-full {speakerUser?.is_teacher ? 'bg-violet-400' : 'bg-green-400'} opacity-75"></span>
												<span class="relative inline-flex rounded-full h-2 w-2 {speakerUser?.is_teacher ? 'bg-violet-500' : 'bg-green-500'}"></span>
											</span>
											{#if speakerUser?.is_teacher}
												🎓 Teacher speaking
											{:else}
												{room.speaker_name} speaking
											{/if}
										</div>
									{/if}

									<div class="text-xs text-gray-400 dark:text-gray-500 ml-auto">
										{formatTime(room.created_at)}
									</div>
								</div>

								<button
									type="button"
									data-no-join="true"
									class="mt-3 w-full py-2 rounded-xl bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 text-violet-700 dark:text-violet-300 text-xs font-medium hover:from-violet-100 hover:to-indigo-100 dark:hover:from-violet-900/30 dark:hover:to-indigo-900/30 mira-transition border border-violet-100 dark:border-violet-800/30"
									on:click|stopPropagation={() => dispatch('join', room.room_id)}
								>
									{#if joining}
										<span class="flex items-center justify-center gap-1.5">
											<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
											</svg>
											Joining...
										</span>
									{:else}
										Join Room
									{/if}
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
