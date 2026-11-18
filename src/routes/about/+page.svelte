<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>About and licences · Lmacaw</title></svelte:head>

<main class="auth-shell">
	<div class="auth-card about-card">
		<a class="brand" href="/"><img class="brand-mark" src="/favicon.svg" alt="" width="24" height="24" /><span>Lmacaw</span></a>
		<h1>About and licences</h1>
		<p>Lmacaw is an open-source meme library licensed under <a href="https://github.com/lmacaw/lmacaw">AGPL-3.0</a>.</p>
		<p>Images come from the maintainers and from openly licensed Openverse sources. Each image’s source, creator and licence are shown in its detail view.</p>
		{#if data.mode === 'public'}
			<p>lmacaw.meme has no accounts for visitors and keeps no personal data about them.</p>
			<p>To ask for an image to be removed, write to <a href="mailto:hello@lmacaw.meme">hello@lmacaw.meme</a>.</p>
		{/if}
	</div>
</main>
