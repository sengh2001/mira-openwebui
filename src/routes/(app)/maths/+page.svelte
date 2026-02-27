<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import ChevronUp from '$lib/components/icons/ChevronUp.svelte';
	import { config } from '$lib/stores';

	// Pipecat backend URL - dynamic from config store
	$: PIPECAT_API_URL = $config?.audio?.pipecat?.url || 'http://localhost:7860';
	let grades = [];
	let selectedGrade = null;
	let topics = [];
	let loading = false;
	let error = null;
	let expandedTopicIndex = null;

	$: if (PIPECAT_API_URL && grades.length === 0) {
		fetchGrades();
	}

	async function fetchGrades() {
		try {
			const res = await fetch(`${PIPECAT_API_URL}/maths/grades`);
			if (res.ok) {
				const data = await res.json();
				grades = data.grades;
				error = null;
			} else {
				error = 'Failed to load grades. Ensure backend is running.';
			}
		} catch (e) {
			error = 'Error connecting to backend: ' + e.message;
		}
	}

	onMount(async () => {
		// Grades are now handled reactively above
	});

	async function loadTopics(grade) {
		selectedGrade = grade;
		loading = true;
		expandedTopicIndex = null; // Reset expansion
		try {
			const res = await fetch(`${PIPECAT_API_URL}/maths/topics/${grade}`);
			if (res.ok) {
				const data = await res.json();
				topics = data.topics;
			}
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	function toggleDetails(index, event) {
		// Prevent triggering parent click if it was a button inside
		event.stopPropagation();
		if (expandedTopicIndex === index) {
			expandedTopicIndex = null;
		} else {
			expandedTopicIndex = index;
		}
	}

	function startSession(topic) {
		const topicId = topic.index;
		const title = encodeURIComponent(topic.improved_topic_name || topic.original_topic);
		goto(`/?topic=${topicId}&title=${title}&maths=true`);
	}
</script>

<div class="h-full w-full flex flex-col p-6 overflow-y-auto bg-gray-50 dark:bg-gray-900">
	<div class="max-w-6xl mx-auto w-full">
		<header class="mb-10 text-center">
			<h1
				class="text-4xl font-extrabold mb-3 text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400"
			>
				Mathematics Curriculum
			</h1>
			<p class="text-lg text-gray-600 dark:text-gray-400">
				Choose your grade and explore topics to begin your learning journey.
			</p>
		</header>

		{#if error}
			<div
				class="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4 rounded-xl mb-8 border border-red-200 dark:border-red-800 shadow-sm text-center"
			>
				{error}
			</div>
		{/if}

		<!-- Grade Selection -->
		<div class="mb-12 flex justify-center">
			<div
				class="inline-flex flex-wrap justify-center gap-3 p-2 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700"
			>
				{#each grades as grade}
					<button
						class="px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200
                        {selectedGrade === grade
							? 'bg-blue-600 text-white shadow-md transform scale-105'
							: 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}"
						on:click={() => loadTopics(grade)}
					>
						Grade {grade}
					</button>
				{/each}
			</div>
		</div>

		<!-- Topics Grid -->
		{#if selectedGrade}
			<div class="animate-fade-in-up">
				<div class="flex items-center justify-between mb-6 px-2">
					<h2 class="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
						<span
							class="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-xs px-2.5 py-1 rounded-full uppercase tracking-wider"
						>
							Grade {selectedGrade}
						</span>
						Topics
					</h2>
					<span class="text-sm text-gray-500 dark:text-gray-400">
						{topics.length} topics available
					</span>
				</div>

				{#if loading}
					<div class="flex flex-col items-center justify-center py-20 text-gray-500">
						<div
							class="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"
						></div>
						<span class="font-medium animate-pulse">Loading curriculum...</span>
					</div>
				{:else if topics.length === 0}
					<div
						class="text-center py-20 bg-white dark:bg-gray-800 rounded-3xl border border-dashed border-gray-300 dark:border-gray-700"
					>
						<p class="text-gray-500 italic">No topics found for Grade {selectedGrade}.</p>
					</div>
				{:else}
					<div class="space-y-4">
						{#each topics as topic, i}
							<div
								class="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-800
                                {expandedTopicIndex === i
									? 'ring-2 ring-blue-500/20 dark:ring-blue-500/30 shadow-md'
									: ''}"
							>
								<!-- Card Header / Summary -->
								<div
									class="p-5 cursor-pointer flex items-start gap-4"
									on:click={(e) => toggleDetails(i, e)}
									role="button"
									tabindex="0"
									on:keydown={(e) => e.key === 'Enter' && toggleDetails(i, e)}
								>
									<!-- Index Badge -->
									<div
										class="flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm"
									>
										{i + 1}
									</div>

									<div class="flex-grow">
										<div class="flex justify-between items-start">
											<h3
												class="font-bold text-lg text-gray-900 dark:text-gray-100 mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
											>
												{topic.original_topic} : {topic.improved_topic_name || topic.original_topic}
											</h3>
											<button
												class="text-gray-400 hover:text-blue-500 transition-transform duration-300 {expandedTopicIndex ===
												i
													? 'rotate-180'
													: ''}"
											>
												<ChevronDown class="w-5 h-5" />
											</button>
										</div>
										<p
											class="text-gray-600 dark:text-gray-400 text-sm leading-relaxed line-clamp-2"
										>
											{topic.topic_summary}
										</p>
									</div>
								</div>

								<!-- Expanded Details -->
								{#if expandedTopicIndex === i}
									<div
										transition:slide={{ duration: 200 }}
										class="bg-gray-50/50 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-700"
									>
										<div class="p-6 grid gap-6 md:grid-cols-2">
											<!-- Topic Overview -->
											<div class="space-y-4">
												<div>
													<h4 class="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
														Topic Summary
													</h4>
													<p class="text-sm text-gray-700 dark:text-gray-300">
														{topic.topic_summary || 'No summary available.'}
													</p>
												</div>
											</div>

											<!-- Learning Objectives -->
											<div class="space-y-4">
												{#if topic.learning_objective}
													<div>
														<h4
															class="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1"
														>
															Learning Objective
														</h4>
														<p
															class="text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700"
														>
															{topic.learning_objective}
														</p>
													</div>
												{/if}

												{#if topic.learning_objective_summary}
													<div>
														<h4
															class="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1"
														>
															Learning Objective Summary
														</h4>
														<p class="text-sm text-gray-600 dark:text-gray-400 italic">
															{topic.learning_objective_summary}
														</p>
													</div>
												{/if}
											</div>

											<!-- Sample QA Preview -->
											{#if topic.sample_qas && topic.sample_qas.length > 0}
												<div>
													<h4
														class="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1"
													>
														<svg
															class="w-4 h-4"
															fill="none"
															viewBox="0 0 24 24"
															stroke="currentColor"
															><path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
															/></svg
														>
														Example Question
													</h4>
													<div
														class="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm"
													>
														<p class="font-medium text-gray-800 dark:text-gray-200 mb-1">
															Q: {topic.sample_qas[0].question.replace(/<[^>]*>/g, '')}
														</p>
														<p class="text-gray-600 dark:text-gray-400 italic">
															A: {topic.sample_qas[0].answer.replace(/<[^>]*>/g, '')}
														</p>
													</div>
												</div>
											{/if}
										</div>

										<!-- Action Footer -->
										<div class="px-6 pb-6 pt-2 flex justify-end">
											<button
												class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/30 transition-all hover:scale-105 flex items-center gap-2"
												on:click={(e) => {
													e.stopPropagation();
													startSession(topic);
												}}
											>
												<span>Start Session</span>
												<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M14 5l7 7m0 0l-7 7m7-7H3"
													/></svg
												>
											</button>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.animate-fade-in-up {
		animation: fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}
</style>
