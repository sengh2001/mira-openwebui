<script>
	import { getContext } from 'svelte';
	const i18n = getContext('i18n');

	export let show = true;
	export let getStartedHandler = () => {};
</script>

{#if show}
	<div class="fixed inset-0 z-[9999] flex items-center justify-center bg-white dark:bg-gray-950">
		<div class="flex flex-col items-center gap-10">
			<!-- Large MIRA Logo -->
			<div class="flex flex-col items-center gap-4">
				<div class="relative">
					<svg viewBox="0 0 500 500" width="160" height="160" class="drop-shadow-lg">
						<rect width="500" height="500" fill="#fff" rx="80"
							class="dark:fill-gray-800" />
						<text x="50%" y="48%" dominant-baseline="central" text-anchor="middle"
							font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="340"
							fill="#1a1a1a" class="dark:fill-white">M</text>
						<rect x="100" y="410" width="300" height="32" rx="16" fill="#E91E8C"/>
					</svg>
				</div>
				<h1 class="text-5xl sm:text-6xl font-bold tracking-tight text-gray-900 dark:text-white">
					MIRA
				</h1>
			</div>

			<!-- Get Started Button -->
			<button
				class="px-10 py-3.5 rounded-full text-white font-semibold text-lg
					bg-gradient-to-r from-pink-500 to-violet-500
					hover:from-pink-600 hover:to-violet-600
					shadow-lg hover:shadow-xl
					transform hover:scale-105
					transition-all duration-200 ease-out"
				on:click={() => {
					getStartedHandler();
				}}
			>
				{$i18n.t('Get started')}
			</button>
		</div>
	</div>
{/if}
