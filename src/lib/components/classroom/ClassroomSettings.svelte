<script lang="ts">
	import { createEventDispatcher, getContext, onMount } from 'svelte';
	import type { ClassroomRoom } from '$lib/apis/classroom';
	import {
		getCurriculumTopics,
		listCurriculumFiles,
		type CurriculumChapter,
		type CurriculumFile
	} from '$lib/apis/classroom';
	import { user } from '$lib/stores';
	import Spinner from '$lib/components/common/Spinner.svelte';

	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher();

	export let rooms: ClassroomRoom[] = [];
	export let loading = false;
	export let pipecatBaseUrl = 'http://localhost:7860';

	let editingRoomId: string | null = null;
	let editRoomName = '';
	let editRoomTopic = '';
	let editRoomType: 'teacher_driven' | 'discussion' = 'teacher_driven';
	let editCurriculumChapterId = '';
	let editCurriculumSectionId = '';
	let editSaving = false;

	// Curriculum data
	let curriculumFiles: CurriculumFile[] = [];
	let curriculumTree: CurriculumChapter[] = [];
	let curriculumAvailable = false;
	let loadingCurriculum = false;
	let showTopicPicker = false;
	let expandedChapters: Set<string> = new Set();
	let expandedSections: Set<string> = new Set();

	onMount(async () => {
		// Load curriculum data on mount
		try {
			loadingCurriculum = true;
			const filesResult = await listCurriculumFiles(pipecatBaseUrl);
			curriculumFiles = filesResult.files || [];
			curriculumAvailable = filesResult.available;

			if (curriculumAvailable) {
				curriculumTree = await getCurriculumTopics(pipecatBaseUrl);
			}
		} catch (e) {
			// Curriculum is optional — if it fails, just disable the picker
			curriculumAvailable = false;
		} finally {
			loadingCurriculum = false;
		}
	});

	async function startEditing(room: ClassroomRoom) {
		editingRoomId = room.room_id;
		editRoomName = room.name;
		editRoomTopic = room.topic || room.current_lesson_topic || '';
		editRoomType = room.room_type || 'teacher_driven';
		editCurriculumChapterId = room.curriculum_chapter_id || '';
		editCurriculumSectionId = room.curriculum_section_id || '';
		showTopicPicker = false;
	}

	function cancelEditing() {
		editingRoomId = null;
		editRoomName = '';
		editRoomTopic = '';
		editRoomType = 'teacher_driven';
		editCurriculumChapterId = '';
		editCurriculumSectionId = '';
		showTopicPicker = false;
	}

	function handleSave() {
		if (!editingRoomId || !editRoomName.trim()) return;
		editSaving = true;

		const room = rooms.find((r) => r.room_id === editingRoomId);
		const typeChanged = room && editRoomType !== room.room_type;

		dispatch('saveRoom', {
			room_id: editingRoomId,
			name: editRoomName.trim(),
			topic: editRoomTopic.trim() || undefined,
			room_type: typeChanged ? editRoomType : undefined,
			curriculum_chapter_id: editCurriculumChapterId || undefined,
			curriculum_section_id: editCurriculumSectionId || undefined
		});
		setTimeout(() => {
			editSaving = false;
			editingRoomId = null;
			showTopicPicker = false;
		}, 600);
	}

	function selectCurriculumTopic(conceptName: string) {
		editRoomTopic = conceptName;
		showTopicPicker = false;
	}

	function selectSection(chapter: CurriculumChapter, section: { section_id: string; title: string; concepts: string[] }) {
		editCurriculumChapterId = chapter.chapter_id;
		editCurriculumSectionId = section.section_id;
		editRoomTopic = `${chapter.title}: ${section.title}`;
		showTopicPicker = false;
	}

	// Computed: sections for the selected chapter (for dropdown)
	$: selectedChapter = curriculumTree.find((c) => c.chapter_id === editCurriculumChapterId);
	$: selectedSection = selectedChapter?.sections.find((s) => s.section_id === editCurriculumSectionId);
	$: sectionConcepts = selectedSection?.concepts || [];

	function toggleChapter(chapterId: string) {
		if (expandedChapters.has(chapterId)) {
			expandedChapters.delete(chapterId);
		} else {
			expandedChapters.add(chapterId);
		}
		expandedChapters = expandedChapters; // trigger reactivity
	}

	function toggleSection(sectionId: string) {
		if (expandedSections.has(sectionId)) {
			expandedSections.delete(sectionId);
		} else {
			expandedSections.add(sectionId);
		}
		expandedSections = expandedSections; // trigger reactivity
	}

	function formatTime(ts: number) {
		return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function getTeacherName(room: ClassroomRoom): string {
		if (!room.teacher_id) return 'None';
		const onlineTeacher = room.users?.find((u) => u.user_id === room.teacher_id);
		if (onlineTeacher) return onlineTeacher.name;
		return room.teacher_id.slice(0, 8) + '...';
	}

	function canDeleteRoom(room: ClassroomRoom): boolean {
		if ($user?.role === 'admin') return true;
		return Boolean(room.teacher_id && $user?.id && room.teacher_id === $user.id);
	}
</script>

<div class="flex flex-col h-full">
	<!-- Header -->
	<div
		class="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 mira-frosted border-b border-gray-100 dark:border-gray-800 px-4 sm:px-6 py-3 sm:py-4"
	>
		<div class="flex items-center justify-between max-w-5xl mx-auto gap-2">
			<div class="flex items-center gap-2 sm:gap-3 min-w-0">
				<div
					class="hidden sm:flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-gray-500 to-gray-600 text-white shadow-lg shrink-0"
				>
					<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
						/>
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
				</div>
				<div class="min-w-0">
					<h1 class="text-base sm:text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">Room Settings</h1>
					<p class="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 truncate">
						Manage room names, topics, and configuration
					</p>
				</div>
			</div>

			<div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
				{#if curriculumAvailable}
					<span
						class="hidden sm:inline-flex px-2 py-1 rounded-lg text-[10px] font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/30"
					>
						📚 {curriculumFiles.length} file{curriculumFiles.length !== 1 ? 's' : ''}
					</span>
				{/if}
				<button
					class="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs sm:text-sm hover:bg-gray-50 dark:hover:bg-gray-800 mira-transition"
					on:click={() => dispatch('back')}
				>
					<svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
						/>
					</svg>
					<span class="hidden sm:inline">Back to Rooms</span>
					<span class="sm:hidden">Back</span>
				</button>
			</div>
		</div>
	</div>

	<!-- Room List -->
	<div class="flex-1 overflow-y-auto">
		<div class="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-3">
			{#if loading}
				<div class="flex items-center justify-center py-16">
					<Spinner className="size-6" />
				</div>
			{:else if rooms.length === 0}
				<div
					class="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500"
				>
					<p class="text-sm font-medium">No rooms to configure</p>
					<button
						class="mt-3 text-xs text-violet-600 hover:underline"
						on:click={() => dispatch('back')}
					>
						Go back and create a room
					</button>
				</div>
			{:else}
				{#each rooms as room (room.room_id)}
					<div
						class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/50 overflow-hidden mira-transition {editingRoomId ===
						room.room_id
							? 'ring-2 ring-violet-500/40'
							: ''}"
					>
					<!-- Room row -->
					<div class="flex items-center gap-2 sm:gap-4 px-3 sm:px-5 py-3 sm:py-4">
						<div
							class="hidden sm:flex flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/30 dark:to-indigo-900/30 items-center justify-center text-lg"
						>
							🏫
						</div>

						<div class="flex-1 min-w-0">
							<h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
								{room.name}
							</h4>
							<div class="flex items-center gap-1.5 sm:gap-2 mt-0.5 flex-wrap">
								{#if room.topic || room.current_lesson_topic}
									<span class="text-[11px] sm:text-xs text-indigo-600 dark:text-indigo-400 truncate max-w-[150px] sm:max-w-none">
										📚 {room.topic || room.current_lesson_topic}
									</span>
								{:else}
									<span class="text-[11px] sm:text-xs text-gray-400 italic">No topic set</span>
								{/if}
								<span class="text-[10px] text-gray-400 hidden sm:inline">·</span>
								<span
									class="text-[10px] text-amber-600 dark:text-amber-400 hidden sm:flex items-center gap-0.5"
								>
									🎓 {getTeacherName(room)}
								</span>
							</div>
						</div>

						<div class="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
								{#if room.user_count > 0}
									<span
										class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200/50 dark:border-red-800/30"
									>
										{room.user_count} online
									</span>
								{:else}
									<span
										class="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500"
									>
										Empty
									</span>
								{/if}
							</div>

							<div class="flex items-center gap-1 flex-shrink-0">
								{#if editingRoomId === room.room_id}
									<button
										class="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 mira-transition"
										on:click={cancelEditing}
									>
										Cancel
									</button>
								{:else}
									<button
										class="p-2 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 mira-transition"
										on:click={() => startEditing(room)}
										title="Edit room"
										aria-label="Edit room {room.name}"
									>
										<svg
											class="w-4 h-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
											/>
										</svg>
									</button>
										{#if canDeleteRoom(room)}
											<button
												class="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 mira-transition"
												on:click={() => dispatch('deleteRoom', room.room_id)}
												title="Delete room"
												aria-label="Delete room {room.name}"
										>
											<svg
												class="w-4 h-4"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
												stroke-width="2"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
												/>
											</svg>
										</button>
									{/if}
								{/if}
							</div>
						</div>

						<!-- Expanded edit form -->
						{#if editingRoomId === room.room_id}
					<div
							class="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/80 px-3 sm:px-5 py-3 sm:py-4 space-y-3 sm:space-y-4"
						>
								<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
									<div>
										<label
											class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5"
											for="edit-room-name-{room.room_id}">Room Name</label
										>
										<input
											id="edit-room-name-{room.room_id}"
											type="text"
											class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mira-transition"
											bind:value={editRoomName}
											on:keydown={(e) => e.key === 'Enter' && handleSave()}
										/>
									</div>
									<div>
										<label
											class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5"
											for="edit-room-topic-{room.room_id}">Topic</label
										>
										<div class="flex gap-2">
											<input
												id="edit-room-topic-{room.room_id}"
												type="text"
												class="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mira-transition"
												placeholder="e.g. Photosynthesis, Solar System"
												bind:value={editRoomTopic}
												on:keydown={(e) => e.key === 'Enter' && handleSave()}
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
										{#if editRoomTopic}
											<p class="mt-1 text-[10px] text-indigo-500">
												Curriculum context will be auto-injected if this matches a loaded concept
											</p>
										{/if}
									</div>
								</div>

							<!-- Chapter / Section Dropdowns (Section = Topic) -->
							{#if curriculumAvailable}
								<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
									<div>
										<label
											class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5"
											for="edit-chapter-{room.room_id}">📘 Chapter</label
										>
										<select
											id="edit-chapter-{room.room_id}"
											class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mira-transition"
											bind:value={editCurriculumChapterId}
											on:change={() => {
												editCurriculumSectionId = '';
												const ch = curriculumTree.find((c) => c.chapter_id === editCurriculumChapterId);
												if (ch && ch.sections.length > 0) {
													editCurriculumSectionId = ch.sections[0].section_id;
													editRoomTopic = `${ch.title}: ${ch.sections[0].title}`;
												}
											}}
										>
											<option value="">-- Select Chapter --</option>
											{#each curriculumTree as ch}
												<option value={ch.chapter_id}>{ch.title}</option>
											{/each}
										</select>
									</div>
									<div>
										<label
											class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5"
											for="edit-section-{room.room_id}">📄 Section (Topic)</label
										>
										<select
											id="edit-section-{room.room_id}"
											class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mira-transition"
											bind:value={editCurriculumSectionId}
											disabled={!editCurriculumChapterId}
											on:change={() => {
												if (selectedChapter && editCurriculumSectionId) {
													const sec = selectedChapter.sections.find((s) => s.section_id === editCurriculumSectionId);
													if (sec) {
														editRoomTopic = `${selectedChapter.title}: ${sec.title}`;
													}
												}
											}}
										>
											<option value="">-- Select Section --</option>
											{#if selectedChapter}
												{#each selectedChapter.sections as sec}
													<option value={sec.section_id}>{sec.title}</option>
												{/each}
											{/if}
										</select>
									</div>
								</div>
								{#if sectionConcepts.length > 0}
									<div class="flex flex-wrap gap-1.5 mt-1">
										<span class="text-[10px] text-gray-400 mr-1">Concepts:</span>
										{#each sectionConcepts as concept}
											<span class="px-2 py-0.5 rounded-lg text-[10px] bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border border-violet-200/50 dark:border-violet-800/30">
												{concept}
											</span>
										{/each}
									</div>
								{/if}
							{/if}

							<!-- Legacy topic picker (browse tree) — kept as fallback -->
							{#if showTopicPicker && curriculumAvailable}
								<div
									class="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10 p-4 max-h-64 overflow-y-auto"
								>
									<div class="flex items-center justify-between mb-3">
										<h5
											class="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider"
										>
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
										{#each curriculumTree as chapter}
											<div class="mb-2">
												<button
													class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-violet-100/50 dark:hover:bg-violet-900/20 mira-transition"
													on:click={() => toggleChapter(chapter.chapter_id)}
													aria-label="Toggle chapter {chapter.title}"
												>
													<svg
														class="w-3.5 h-3.5 text-gray-400 mira-transition {expandedChapters.has(chapter.chapter_id) ? 'rotate-90' : ''}"
														fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
													>
														<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
													</svg>
													<span>📘 {chapter.title}</span>
												</button>

												{#if expandedChapters.has(chapter.chapter_id)}
													<div class="ml-5 mt-1 space-y-1">
														{#each chapter.sections as section}
															<button
																class="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left text-xs mira-transition
																	{editCurriculumSectionId === section.section_id
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
												{/if}
											</div>
										{/each}
									{/if}
								</div>
							{/if}

								<!-- Room Type -->
								<div>
									<label
										class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5"
									>
										🏷️ Room Type
									</label>
									<div class="flex gap-4">
										<label class="flex items-center gap-2 cursor-pointer">
											<input
												type="radio"
												name="edit-room-type-{room.room_id}"
												value="teacher_driven"
												bind:group={editRoomType}
												class="accent-violet-600"
											/>
											<span class="text-sm text-gray-700 dark:text-gray-300">🎓 Teacher Driven</span>
										</label>
										<label class="flex items-center gap-2 cursor-pointer">
											<input
												type="radio"
												name="edit-room-type-{room.room_id}"
												value="discussion"
												bind:group={editRoomType}
												class="accent-violet-600"
											/>
											<span class="text-sm text-gray-700 dark:text-gray-300">💬 Discussion</span>
										</label>
									</div>
									{#if editRoomType === 'discussion'}
										<p class="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
											Discussion mode: students take turns with Mira in micro-sessions visible to all
										</p>
									{/if}
								</div>

								<div class="flex items-center justify-between">
									<div class="flex items-center gap-3 text-xs text-gray-400">
										<span>ID: {room.room_id}</span>
										<span>{formatTime(room.created_at)}</span>
									</div>
									<div class="flex gap-2">
										<button
											class="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 mira-transition"
											on:click={cancelEditing}
										>
											Cancel
										</button>
										<button
											class="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium hover:from-violet-700 hover:to-indigo-700 shadow-md mira-transition disabled:opacity-50"
											on:click={handleSave}
											disabled={!editRoomName.trim() || editSaving}
										>
											{editSaving ? 'Saving...' : 'Save Changes'}
										</button>
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
