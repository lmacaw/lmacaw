<script lang="ts">
	import { onMount } from 'svelte';

	let expired = $state(false);

	onMount(() => {
		const token = location.hash.slice(1);
		if (!token) {
			expired = true;
			return;
		}

		history.replaceState(history.state, '', location.pathname + location.search);
		void signIn(token);
	});

	async function signIn(token: string) {
		try {
			const response = await fetch('/api/v1/session', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token })
			});
			if (response.status === 204) {
				location.assign('/');
				return;
			}
		} catch {
			// The link may have been consumed before the browser lost the connection.
		}
		expired = true;
	}
</script>

<svelte:head>
	<title>Sign in · Lmacaw</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="auth-shell">
	<div class="auth-card">
		<div class="brand"><img class="brand-mark" src="/favicon.svg" alt="" width="24" height="24" /><span>Lmacaw</span></div>
		<h1>Sign in</h1>
		{#if expired}
			<p class="notice">This link has expired. <a class="text-button" href="/">Request a new one.</a></p>
		{:else}
			<p class="notice" role="status">Signing you in…</p>
		{/if}
	</div>
</main>
