<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { WEBUI_BASE_URL } from '$lib/constants';
	import { showSidebar } from '$lib/stores';
	import MenuLines from '$lib/components/icons/MenuLines.svelte';

	const subjects = [
		{
			id: 'grade-6-science',
			title: 'Grade 6 Science',
			description: 'Explore the wonders of the natural world, from ecosystems to energy.',
			image:
				'https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&q=80&w=300&h=200',
			color: 'bg-blue-50 dark:bg-blue-900/20',
			textColor: 'text-blue-700 dark:text-blue-300'
		},
		{
			id: 'ancient-history',
			title: 'Ancient History',
			description: 'Journey back in time to discover the civilizations of the past.',
			image:
				'https://images.unsplash.com/photo-1461360228754-6e81c478b882?auto=format&fit=crop&q=80&w=300&h=200',
			color: 'bg-amber-50 dark:bg-amber-900/20',
			textColor: 'text-amber-700 dark:text-amber-300'
		},
		{
			id: 'mathematics-basics',
			title: 'Mathematics Basics',
			description: 'Master the fundamentals of arithmetic, geometry, and algebra.',
			image:
				'https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&q=80&w=300&h=200',
			color: 'bg-emerald-50 dark:bg-emerald-900/20',
			textColor: 'text-emerald-700 dark:text-emerald-300'
		},
		{
			id: 'intro-coding',
			title: 'Introduction to Coding',
			description: 'Learn the logic behind computer programming with Python.',
			image:
				'https://images.unsplash.com/photo-1587620962725-abab7fe55159?auto=format&fit=crop&q=80&w=300&h=200',
			color: 'bg-purple-50 dark:bg-purple-900/20',
			textColor: 'text-purple-700 dark:text-purple-300'
		}
	];
</script>

<div
	class="h-full w-full bg-white dark:bg-gray-900 relative overflow-y-auto {$showSidebar
		? 'md:ml-[var(--sidebar-width)]'
		: ''} transition-all duration-300"
>
	<div class="fixed top-4 left-4 z-40 md:hidden">
		<button
			type="button"
			class="p-2 rounded-xl bg-white/80 dark:bg-gray-900/80 shadow-sm border border-gray-100 dark:border-gray-800 backdrop-blur-md"
			on:click={() => showSidebar.set(!$showSidebar)}
			aria-label="Toggle Sidebar"
		>
			<MenuLines className="size-5" />
		</button>
	</div>

	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
		<div class="text-center mb-8 sm:mb-12">
			<h1
				class="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-gray-900 dark:text-white tracking-tight"
			>
				Explore & Learn
			</h1>
			<p
				class="max-w-2xl mx-auto mt-3 sm:mt-5 text-base sm:text-xl text-gray-500 dark:text-gray-400"
			>
				Dive into interactive lessons and chat with AI tutors to master any subject.
			</p>
		</div>

		<div
			class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 lg:gap-8"
		>
			{#each subjects as subject}
				<button
					type="button"
					class="group relative flex flex-col overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 block text-left w-full"
					on:click={() => goto(`/learn/${subject.id}`)}
				>
					<div class="aspect-video w-full overflow-hidden bg-gray-200 dark:bg-gray-700 relative">
						<img
							src={subject.image}
							alt={subject.title}
							loading="lazy"
							class="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
						/>
						<div
							class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300"
						></div>
					</div>
					<div class="flex flex-1 flex-col justify-between p-5">
						<div class="flex-1">
							<h3
								class="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
							>
								{subject.title}
							</h3>
							<p class="mt-2 text-sm sm:text-base text-gray-500 dark:text-gray-400 line-clamp-3">
								{subject.description}
							</p>
						</div>
						<div class="mt-4 flex items-center">
							<div
								class={`text-xs sm:text-sm font-medium px-3 py-1.5 rounded-full ${subject.color} ${subject.textColor}`}
							>
								Start Learning
							</div>
						</div>
					</div>
				</button>
			{/each}
		</div>
	</div>
</div>
