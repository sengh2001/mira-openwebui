<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';

	import { page } from '$app/stores';
	import { config } from '$lib/stores';

	import Chat from '$lib/components/chat/Chat.svelte';

	onMount(() => {
		if ($page.url.searchParams.get('error')) {
			toast.error($page.url.searchParams.get('error') || 'An unknown error occurred.');
		}

		// When Pipecat is enabled, stay on the chat page (voice-first experience).
		// Otherwise, redirect to /learn as the default landing page.
		const pipecatEnabled = $config?.audio?.pipecat?.enabled;
		const hasCallParam = $page.url.searchParams.get('call') === 'true';
		const hasChatInput = !!sessionStorage.getItem('chat-input');

		if (!pipecatEnabled && !hasChatInput && !hasCallParam) {
			goto('/learn');
		}
	});
</script>

<Chat />
