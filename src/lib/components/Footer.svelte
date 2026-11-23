<script lang="ts">
	let { publicMode }: { publicMode: boolean } = $props();
</script>

<footer class="site-footer">
	<a href="/about">About and licences</a>
	{#if publicMode}<a href="mailto:hello@lmacaw.meme" aria-label="Takedown requests: hello@lmacaw.meme">hello@lmacaw.meme</a>{/if}
</footer>
