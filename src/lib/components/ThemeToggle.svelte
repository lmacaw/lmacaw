<script lang="ts">
	import Icon from './Icon.svelte';

	let { theme, ontheme, small = false, disabled = false }: {
		theme: 'system' | 'light' | 'dark'; ontheme: (value: 'system' | 'light' | 'dark') => void; small?: boolean; disabled?: boolean;
	} = $props();
	// One button cycles the appearance: system → light → dark.
	const themes = {
		system: { label: 'System', icon: 'monitor', next: 'light' },
		light: { label: 'Light', icon: 'sun', next: 'dark' },
		dark: { label: 'Dark', icon: 'moon', next: 'system' }
	} as const;
</script>

<button class="icon-button" class:small {disabled} aria-label="Appearance: {themes[theme].label}" title="Appearance: {themes[theme].label}" onclick={() => ontheme(themes[theme].next)}><Icon name={themes[theme].icon} size={small ? 15 : 16} /></button>
