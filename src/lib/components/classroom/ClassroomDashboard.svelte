<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { DashboardStats, SessionRecord } from '$lib/apis/classroom';

	const dispatch = createEventDispatcher();

	export let stats: DashboardStats | null = null;

	function formatDuration(secs: number): string {
		if (!secs || secs <= 0) return '—';
		if (secs < 60) return `${Math.round(secs)}s`;
		const mins = Math.floor(secs / 60);
		const remaining = Math.round(secs % 60);
		if (mins < 60) return `${mins}m ${remaining}s`;
		const hrs = Math.floor(mins / 60);
		return `${hrs}h ${mins % 60}m`;
	}

	function formatDate(ts: number) {
		return new Date(ts * 1000).toLocaleDateString([], {
			month: 'short', day: 'numeric',
			hour: '2-digit', minute: '2-digit'
		});
	}
</script>

<div class="flex flex-col h-full bg-white dark:bg-gray-900">
	<!-- Header -->
	<div class="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 mira-frosted border-b border-gray-100 dark:border-gray-800 px-4 sm:px-6 py-3 sm:py-4">
		<div class="flex items-center gap-2 sm:gap-3 max-w-5xl mx-auto">
			<button
				class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition text-gray-500 shrink-0"
				on:click={() => dispatch('back')}
			>
				<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
				</svg>
			</button>
			<div class="flex items-center gap-2 min-w-0">
				<svg class="w-4 h-4 sm:w-5 sm:h-5 text-violet-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
				</svg>
				<h1 class="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">Teacher Dashboard</h1>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		<div class="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
			{#if !stats}
				<!-- Loading state -->
				<div class="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
					<svg class="w-8 h-8 animate-spin mb-3" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<p class="text-sm">Loading dashboard...</p>
				</div>
			{:else}
			<!-- Stats Cards -->
			<div class="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-4 mb-6 sm:mb-8">
				<!-- Total Sessions -->
				<div class="p-3 sm:p-4 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800">
					<div class="text-lg sm:text-2xl font-bold text-violet-700 dark:text-violet-300">
						{stats.total_sessions}
					</div>
					<div class="text-[10px] sm:text-xs text-violet-600 dark:text-violet-400 mt-0.5 sm:mt-1">Sessions</div>
				</div>

				<!-- Total Messages -->
				<div class="p-3 sm:p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
					<div class="text-lg sm:text-2xl font-bold text-blue-700 dark:text-blue-300">
						{stats.total_messages}
					</div>
					<div class="text-[10px] sm:text-xs text-blue-600 dark:text-blue-400 mt-0.5 sm:mt-1">Messages</div>
				</div>

				<!-- Unique Participants -->
				<div class="p-3 sm:p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800">
					<div class="text-lg sm:text-2xl font-bold text-green-700 dark:text-green-300">
						{stats.unique_participants}
					</div>
					<div class="text-[10px] sm:text-xs text-green-600 dark:text-green-400 mt-0.5 sm:mt-1">Users</div>
				</div>

				<!-- Avg Duration -->
				<div class="p-3 sm:p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800">
					<div class="text-lg sm:text-2xl font-bold text-amber-700 dark:text-amber-300">
						{formatDuration(stats.avg_session_duration_secs)}
					</div>
					<div class="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400 mt-0.5 sm:mt-1">Avg Time</div>
				</div>

				<!-- Hand Raises -->
				<div class="p-3 sm:p-4 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800">
					<div class="text-lg sm:text-2xl font-bold text-rose-700 dark:text-rose-300">
						{stats.total_hand_raises}
					</div>
					<div class="text-[10px] sm:text-xs text-rose-600 dark:text-rose-400 mt-0.5 sm:mt-1">✋ Hands</div>
				</div>

				<!-- Reactions -->
				<div class="p-3 sm:p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800">
					<div class="text-lg sm:text-2xl font-bold text-emerald-700 dark:text-emerald-300">
						{stats.total_reactions}
					</div>
					<div class="text-[10px] sm:text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 sm:mt-1">🎉 Reacts</div>
				</div>
			</div>

				<!-- Recent Sessions -->
				<div>
					<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">
						Recent Sessions
					</h2>
					{#if stats.recent_sessions && stats.recent_sessions.length > 0}
					<div class="space-y-2">
						{#each stats.recent_sessions as session}
							<div class="p-3 sm:p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/50">
								<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
									<div class="min-w-0">
										<h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
											{session.room_name}
										</h4>
										<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 sm:mt-1">
											{formatDate(session.started_at)}
											{#if session.ended_at}
												· {formatDuration(session.ended_at - session.started_at)}
											{:else}
												· <span class="text-green-500">Active</span>
											{/if}
										</p>
									</div>
									<div class="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs text-gray-400 shrink-0">
										<span class="flex items-center gap-1">
											<svg class="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375" />
											</svg>
											{session.message_count}
										</span>
										<span class="flex items-center gap-1">
											<svg class="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
											</svg>
											{session.participant_count}
										</span>
										{#if session.summary}
											<span class="text-violet-500" title="Has summary">📋</span>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
					{:else}
						<div class="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-500">
							<p class="text-sm">No sessions recorded yet</p>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
