<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	/* Mock Data - In a real app, this would come from a backend/API */
	const contentDatabase = {
		'grade-6-science': {
			title: 'Grade 6 Science',
			sections: [
				{
					id: 'ecosystems',
					title: '1. Ecosystems',
					content: `An ecosystem is a community of living organisms in conjunction with the nonliving components of their environment, interacting as a system. These biotic and abiotic components are linked together through nutrient cycles and energy flows. Energy enters the system through photosynthesis and is incorporated into plant tissue. By feeding on plants and on one another, animals play an important role in the movement of matter and energy through the system. They also influence the quantity of plant and microbial biomass present. By breaking down dead organic matter, decomposers release carbon back to the atmosphere and facilitate nutrient cycling by converting nutrients stored in dead biomass back to a form that can be readily used by plants and other microbes.`
				},
				{
					id: 'photosynthesis',
					title: '2. Photosynthesis',
					content: `Photosynthesis is a process used by plants and other organisms to convert light energy into chemical energy that, through cellular respiration, can later be released to fuel the organism's activities. Some of this chemical energy is stored in carbohydrate molecules, such as sugars and starches, which are synthesized from carbon dioxide and water – hence the name photosynthesis. Photosynthesis is largely responsible for producing and maintaining the oxygen content of the Earth's atmosphere, and supplies most of the energy necessary for life on Earth.`
				},
				{
					id: 'matter',
					title: '3. Matter and Energy',
					content: `Matter is anything that has mass and takes up space. Energy is the ability to do work or cause change. In ecosystems, matter cycles and energy flows. Producers verify energy from the sun into chemical energy. Consumers eat producers to get energy. Decomposers break down dead organisms and return nutrients to the soil.`
				}
			]
		},
		'ancient-history': {
			title: 'Ancient History',
			sections: [
				{
					id: 'mesopotamia',
					title: '1. Mesopotamia',
					content: `Mesopotamia is a historical region of Western Asia situated within the Tigris–Euphrates river system, in the northern part of the Fertile Crescent. It occupies the area of present-day Iraq, and parts of Iran, Turkey, Syria and Kuwait. The Sumerians and Akkadians (including Assyrians and Babylonians) dominated Mesopotamia from the beginning of written history (c. 3100 BC) to the fall of Babylon in 539 BC, when it was conquered by the Achaemenid Empire.`
				},
				{
					id: 'egypt',
					title: '2. Ancient Egypt',
					content: `Ancient Egypt was a civilization of ancient North Africa, concentrated along the lower reaches of the Nile River, situated in the place that is now the country Egypt. Ancient Egyptian civilization followed prehistoric Egypt and coalesced around 3100 BC (according to conventional Egyptian chronology) with the political unification of Upper and Lower Egypt under Menes (often identified with Narmer).`
				}
			]
		},
		'mathematics-basics': {
			title: 'Mathematics Basics',
			sections: [
				{
					id: 'arithmetic',
					title: '1. Arithmetic',
					content: `Arithmetic is a branch of mathematics that consists of the study of numbers, especially the properties of the traditional operations on them—addition, subtraction, multiplication, division, exponentiation, and extraction of roots. Arithmetic is an elementary part of number theory, and number theory is considered to be one of the top-level divisions of modern mathematics, along with algebra, geometry, and analysis.`
				}
			]
		},
		'intro-coding': {
			title: 'Introduction to Coding',
			sections: [
				{
					id: 'python-intro',
					title: '1. Why Python?',
					content: `Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation. Python is dynamically typed and garbage-collected. It supports multiple programming paradigms, including structured (particularly procedural), object-oriented and functional programming. It is often described as a "batteries included" language due to its comprehensive standard library.`
				}
			]
		}
	};

	$: slug = $page.params.slug;
	$: subject = contentDatabase[slug];

	const startChat = (section = null) => {
		let prompt = '';
		let context = '';

		if (section) {
			prompt = `I am studying ${subject.title}, specifically the section on "${section.title}". Can you help me understand this better? Please act as a teacher for a 6th grade student.`;
			context = section.content;
		} else {
			prompt = `I am studying ${subject.title}. Can you quiz me on the key concepts?`;
			context = subject.sections.map((s) => s.content).join('\n\n');
		}

		const chatInput = {
			prompt: prompt,
			files: [
				{
					type: 'text',
					name: `Context: ${section ? section.title : subject.title}`,
					context: 'full',
					url: '',
					status: 'processed',
					content: context
				}
			],
			selectedToolIds: [],
			selectedFilterIds: [],
			webSearchEnabled: false,
			imageGenerationEnabled: false,
			codeInterpreterEnabled: false
		};

		sessionStorage.setItem('chat-input', JSON.stringify(chatInput));
		goto('/');
	};
</script>

<div class="h-full w-full bg-white dark:bg-gray-900 relative overflow-y-auto">
	{#if subject}
		<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
			<button
				class="mb-6 flex items-center text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition"
				on:click={() => goto('/learn')}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.5"
					stroke="currentColor"
					class="w-4 h-4 mr-1"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
					/>
				</svg>
				Back to library
			</button>

			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-8">
				<h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{subject.title}</h1>
				<button
					class="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-full font-medium text-sm hover:opacity-80 transition self-start sm:self-auto shrink-0"
					on:click={() => startChat()}
				>
					Chat with Content
				</button>
			</div>

			<div class="space-y-12">
				{#each subject.sections as section}
					<div class="prose dark:prose-invert max-w-none">
						<div class="flex items-center justify-between gap-2 mb-4">
							<h2 class="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-100 m-0">
								{section.title}
							</h2>
							<button
								class="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
								title="Ask AI about this"
								on:click={() => startChat(section)}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
									class="w-5 h-5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
									/>
								</svg>
							</button>
						</div>
						<p class="text-base sm:text-lg leading-relaxed text-gray-600 dark:text-gray-300">
							{section.content}
						</p>
					</div>
					<div class="border-t border-gray-100 dark:border-gray-800 my-8"></div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="flex items-center justify-center h-full">
			<div class="text-center">
				<h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Subject Not Found</h2>
				<p class="mt-2 text-gray-500">The subject you are looking for does not exist.</p>
				<button class="mt-4 text-blue-600 hover:underline" on:click={() => goto('/learn')}>
					Return to library
				</button>
			</div>
		</div>
	{/if}
</div>
