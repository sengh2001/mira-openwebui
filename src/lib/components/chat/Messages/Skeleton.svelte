<script lang="ts">
	import { config } from '$lib/stores';

	export let size = 'md';
</script>

<span class="inline-flex items-center gap-1.5 {size === 'md' ? 'my-2' : 'my-1'} mx-1">
	{#if size === 'md' && $config?.audio?.pipecat?.enabled}
		<span class="text-xs font-medium mira-gradient-text">Mira is thinking</span>
	{/if}
	<span class="inline-flex items-center gap-1">
		{#each [0, 1, 2] as i}
			<span
				class="rounded-full mira-thinking-dot {size === 'md'
					? 'size-2'
					: size === 'xs'
						? 'size-1'
						: 'size-1.5'}"
				style="background: linear-gradient(135deg, #ec4899, #8b5cf6); animation-delay: {i * 0.2}s"
			></span>
		{/each}
	</span>
</span>
