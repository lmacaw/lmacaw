<script lang="ts">
	import { onMount } from 'svelte';

	let invitation = $state(''), email = $state(''), password = $state(''), message = $state('');
	let pending = $state(false), ready = $state(false);
	const invalidInvitation = 'This invitation is invalid or already used.';

	onMount(() => {
		invitation = location.hash.slice(1);
		if (!invitation) message = invalidInvitation;
		ready = true;
	});

	async function register(event: SubmitEvent) {
		event.preventDefault();
		if (!invitation || pending) return;
		pending = true;
		message = '';
		try {
			const response = await fetch('/api/v1/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ invitation, email, password })
			});
			if (response.status === 201) {
				location.assign('/');
				return;
			}
			if (response.status === 400) message = invalidInvitation;
			else if (response.status === 429) message = 'Too many attempts. Try again later.';
			else message = 'Unable to create account.';
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
		<form method="post" onsubmit={register}>
			<label class="field-label" for="email">Email</label>
			<input id="email" class="input" type="email" autocomplete="email" bind:value={email} required />
			<label class="field-label" for="password">Password</label>
			<input id="password" class="input" type="password" autocomplete="new-password" minlength="12" maxlength="1024" aria-describedby="password-hint" bind:value={password} required />
			<p id="password-hint" class="hint">At least 12 characters</p>
			<button class="button primary" type="submit" disabled={!ready || !invitation || pending}>Create account</button>
		</form>
		{#if message}<p class="error" role="alert">{message}</p>{/if}
	</div>
</main>
