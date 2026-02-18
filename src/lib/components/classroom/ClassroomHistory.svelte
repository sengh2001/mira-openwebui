<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { SessionRecord, SessionMessage, QuizQuestion } from '$lib/apis/classroom';

	const dispatch = createEventDispatcher();

	export let sessions: SessionRecord[] = [];
	export let selectedSession: { session: SessionRecord; messages: SessionMessage[] } | null = null;
	export let sessionSummary: { summary: string; key_concepts?: string[]; quiz?: QuizQuestion[] } | null = null;
	export let loadingSummary = false;

	let quizAnswers: Record<number, number> = {};
	let quizSubmitted = false;

	function formatDate(ts: number) {
		return new Date(ts * 1000).toLocaleDateString([], {
			month: 'short', day: 'numeric', year: 'numeric',
			hour: '2-digit', minute: '2-digit'
		});
	}

	function formatDuration(start: number, end: number | null) {
		if (!end) return 'In progress';
		const secs = Math.round(end - start);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		return `${mins}m ${secs % 60}s`;
	}

	function selectQuizAnswer(qIdx: number, aIdx: number) {
		if (quizSubmitted) return;
		quizAnswers = { ...quizAnswers, [qIdx]: aIdx };
	}

	function submitQuiz() {
		quizSubmitted = true;
	}

	function resetQuiz() {
		quizAnswers = {};
		quizSubmitted = false;
	}

	$: if (selectedSession) {
		quizAnswers = {};
		quizSubmitted = false;
	}
</script>

<div class="flex flex-col h-full bg-white dark:bg-gray-900">
	<!-- Header -->
	<div class="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 mira-frosted border-b border-gray-100 dark:border-gray-800 px-4 sm:px-6 py-3 sm:py-4">
		<div class="flex items-center gap-2 sm:gap-3 max-w-5xl mx-auto">
			<button
				class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition text-gray-500 shrink-0"
				on:click={() => { if (selectedSession) { selectedSession = null; sessionSummary = null; } else { dispatch('back'); } }}
			>
				<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
				</svg>
			</button>
			<div class="flex items-center gap-2 min-w-0">
				<svg class="w-4 h-4 sm:w-5 sm:h-5 text-violet-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
				</svg>
				<h1 class="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
					{selectedSession ? selectedSession.session.room_name : 'Session History'}
				</h1>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		<div class="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
			{#if selectedSession}
				<!-- Session Detail View -->
				<div class="space-y-6">
				<!-- Session Info Card -->
				<div class="p-3 sm:p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
						<div class="min-w-0">
							<p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
								{formatDate(selectedSession.session.started_at)}
								· {formatDuration(selectedSession.session.started_at, selectedSession.session.ended_at)}
								· {selectedSession.session.message_count} msgs
								· {selectedSession.session.participant_count} users
							</p>
						</div>
						<button
							class="self-start sm:self-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition disabled:opacity-50 whitespace-nowrap shrink-0"
							on:click={() => dispatch('generateSummary', selectedSession?.session.id)}
							disabled={loadingSummary}
						>
							{#if loadingSummary}
								Generating...
							{:else if sessionSummary}
								Refresh Summary
							{:else}
								Generate Summary & Quiz
							{/if}
						</button>
					</div>
				</div>

					<!-- Summary & Quiz -->
					{#if sessionSummary}
						<div class="space-y-4">
							<!-- Summary -->
							<div class="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
								<h3 class="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">📋 Session Summary</h3>
								<p class="text-sm text-blue-700 dark:text-blue-400">{sessionSummary.summary}</p>
								{#if sessionSummary.key_concepts}
									<div class="mt-3 flex flex-wrap gap-1.5">
										{#each sessionSummary.key_concepts as concept}
											<span class="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-800/50 text-blue-600 dark:text-blue-300 text-xs">
												{concept}
											</span>
										{/each}
									</div>
								{/if}
							</div>

							<!-- Quiz -->
							{#if sessionSummary.quiz && sessionSummary.quiz.length > 0}
								<div class="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
									<div class="flex items-center justify-between mb-4">
										<h3 class="text-sm font-semibold text-emerald-800 dark:text-emerald-300">🎯 Quick Quiz</h3>
										{#if quizSubmitted}
											<button
												class="text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
												on:click={resetQuiz}
											>
												Try Again
											</button>
										{/if}
									</div>
									<div class="space-y-4">
										{#each sessionSummary.quiz as q, qIdx}
											<div class="space-y-2">
												<p class="text-sm font-medium text-gray-800 dark:text-gray-200">
													{qIdx + 1}. {q.question}
												</p>
												<div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
													{#each q.options as opt, oIdx}
														<button
															class="text-left px-3 py-2 rounded-lg text-xs transition border
															{quizSubmitted
																? oIdx === q.correct
																	? 'bg-green-100 dark:bg-green-900/30 border-green-400 text-green-800 dark:text-green-300'
																	: quizAnswers[qIdx] === oIdx
																		? 'bg-red-100 dark:bg-red-900/30 border-red-400 text-red-800 dark:text-red-300'
																		: 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'
																: quizAnswers[qIdx] === oIdx
																	? 'bg-violet-50 dark:bg-violet-900/20 border-violet-400 text-violet-700 dark:text-violet-300'
																	: 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-violet-300'}"
															on:click={() => selectQuizAnswer(qIdx, oIdx)}
														>
															{String.fromCharCode(65 + oIdx)}. {opt}
														</button>
													{/each}
												</div>
												{#if quizSubmitted && q.explanation}
													<p class="text-xs text-gray-500 dark:text-gray-400 pl-2 border-l-2 border-emerald-300 dark:border-emerald-700">
														{q.explanation}
													</p>
												{/if}
											</div>
										{/each}
										{#if !quizSubmitted}
											<button
												class="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition disabled:opacity-50"
												on:click={submitQuiz}
												disabled={Object.keys(quizAnswers).length < (sessionSummary?.quiz?.length || 0)}
											>
												Submit Answers
											</button>
										{:else}
											{@const correct = sessionSummary.quiz.filter((q, i) => quizAnswers[i] === q.correct).length}
											<div class="text-center py-2 text-sm font-medium {correct === sessionSummary.quiz.length ? 'text-green-600' : 'text-amber-600'}">
												Score: {correct}/{sessionSummary.quiz.length}
												{correct === sessionSummary.quiz.length ? ' 🎉 Perfect!' : ''}
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Messages -->
					<div>
						<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">
							Conversation
						</h3>
						<div class="space-y-2">
							{#each selectedSession.messages as msg}
								<div class="flex {msg.role === 'assistant' ? '' : 'justify-end'}">
							<div
									class="max-w-[85%] sm:max-w-[75%] px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-sm leading-relaxed
										{msg.role === 'assistant'
											? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-md'
											: 'bg-violet-600 text-white rounded-br-md'}"
									>
										{#if msg.speaker_name}
											<div class="text-[10px] font-semibold uppercase tracking-wider mb-1
												{msg.role === 'assistant'
													? 'text-violet-600 dark:text-violet-400'
													: 'text-violet-200'}">
												{msg.speaker_name}
											</div>
										{/if}
										{msg.content}
										{#if msg.reaction_counts && Object.keys(msg.reaction_counts).length > 0}
											<div class="flex gap-1 mt-1">
												{#each Object.entries(msg.reaction_counts) as [emoji, count]}
													<span class="px-1.5 py-0.5 rounded-full bg-black/10 dark:bg-white/10 text-[10px]">
														{emoji} {count}
													</span>
												{/each}
											</div>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{:else}
				<!-- Sessions List -->
				{#if sessions.length === 0}
					<div class="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
						<svg class="w-12 h-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
						</svg>
						<p class="text-sm font-medium">No sessions yet</p>
						<p class="text-xs mt-1">Sessions are recorded when users join a classroom</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each sessions as session}
						<button
							class="w-full text-left p-3 sm:p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/50 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-sm transition-all"
							on:click={() => dispatch('selectSession', session.id)}
						>
							<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
								<div class="min-w-0">
									<h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
										{session.room_name}
									</h4>
									<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 sm:mt-1">
										{formatDate(session.started_at)}
										· {formatDuration(session.started_at, session.ended_at)}
									</p>
								</div>
								<div class="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs text-gray-400 shrink-0">
									<span>{session.message_count} msgs</span>
									<span>{session.participant_count} users</span>
									{#if session.summary}
										<span class="text-violet-500">📋</span>
									{/if}
								</div>
							</div>
						</button>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
