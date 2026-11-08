<script lang="ts">
	import { onMount } from 'svelte';
	let token = $state(''), email = $state(''), password = $state(''), message = $state(''), complete = $state(false), ready = $state(false);
	onMount(() => { token = window.location.hash.slice(1); ready = true; });
	async function register(event: SubmitEvent) {
		event.preventDefault(); message = '';
		try {
			const response = await fetch('/api/v1/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, email, password }) });
			if (!response.ok) { message = 'Unable to create account.'; return; }
			complete = true; password = ''; token = '';
		} catch { message = 'Unable to connect.'; }
	}
</script>
<svelte:head><title>Invitation · Lmacaw</title><meta name="referrer" content="no-referrer" /></svelte:head>
<main class="auth-shell"><div class="auth-card"><div class="brand"><span class="brand-mark">L</span><span>Lmacaw</span></div>{#if complete}<h1>Account created</h1><a class="button primary" href="/">Sign in</a>{:else}<h1>Create account</h1><form onsubmit={register}><label class="field-label" for="email">Email</label><input id="email" class="input" type="email" autocomplete="username" bind:value={email} required /><label class="field-label" for="password">Password</label><input id="password" class="input" type="password" autocomplete="new-password" minlength="12" bind:value={password} required /><button class="button primary" type="submit" disabled={!ready || !token}>Create account</button></form>{#if message}<p class="error" role="alert">{message}</p>{/if}{/if}</div></main>
