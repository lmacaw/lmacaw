import { expect, test } from 'vitest';
import { shareTitle } from '$lib/share';

test('public mode says the item shows on the public site, not with members', () => {
	expect(shareTitle(false, true)).toBe('Show on public site');
	expect(shareTitle(true, true)).toBe('Shown on public site');
});

test('password mode keeps the members wording', () => {
	expect(shareTitle(false, false)).toBe('Share with members');
	expect(shareTitle(true, false)).toBe('Shared with members');
});
