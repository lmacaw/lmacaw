<script lang="ts">
	import { page } from '$app/state';
	import Footer from '$lib/components/Footer.svelte';
	import '../app.css';
	let { children } = $props();
	const publicMode = $derived(page.data.mode === 'public');
	// Public mode has no sign-in or invitations, so the emailed-link pages only point home.
	const authLinkPage = $derived(page.route.id === '/invite' || page.route.id === '/signin');
</script>

<div class="site-shell">
	{#if publicMode && authLinkPage}
		<main class="auth-shell"><a class="text-button" href="/">Back to Lmacaw</a></main>
	{:else}
		{@render children()}
	{/if}
	<Footer {publicMode} />
</div>
