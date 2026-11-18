<script lang="ts">
	import { onMount } from 'svelte';

	let token = $state(''), email = $state(''), message = $state('');
	let pending = $state(false), complete = $state(false), ready = $state(false);

	onMount(() => {
		token = location.hash.slice(1);
		ready = true;
	});

	async function requestLink(event: SubmitEvent) {
		event.preventDefault();
		if (!token || pending) return;
		pending = true;
		message = '';
		try {
			const response = await fetch('/api/v1/session/link', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, invitation: token })
			});
			if (response.status !== 202) {
				message = response.status === 429 ? 'Too many attempts. Try again later.' : 'Unable to request a sign-in link.';
				return;
			}
			complete = true;
			token = '';
		} catch {
			message = 'Unable to connect.';
		} finally {
			pending = false;
		}
	}
</script>

<svelte:head>
	<title>Invitation · Lmacaw</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="auth-shell">
	<div class="auth-card">
		<div class="brand"><img class="brand-mark" src="/favicon.svg" alt="" width="24" height="24" /><span>Lmacaw</span></div>
		<h1>Create account</h1>
		{#if complete}
			<p class="notice" role="status">Check your email for a sign-in link.</p>
		{:else}
			<form onsubmit={requestLink}>
				<label class="field-label" for="email">Email</label>
				<input id="email" class="input" type="email" autocomplete="email" bind:value={email} required />
				<button class="button primary" type="submit" disabled={!ready || !token || pending}>Create account</button>
			</form>
			{#if message}<p class="error" role="alert">{message}</p>{/if}
		{/if}
	</div>
</main>
