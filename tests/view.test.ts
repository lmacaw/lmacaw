import { expect, test } from 'vitest';
import { viewFromUrl, viewHref } from '$lib/view';

const at = (href: string) => viewFromUrl(new URL(href, 'https://lmacaw.test'));

test('the home URL is the library, so the brand link returns to it', () => {
	expect(at('/')).toEqual({ scope: 'library', collection: '' });
	expect(viewHref('library')).toBe('/');
});

test('every view round-trips through the URL', () => {
	for (const scope of ['library', 'favorites', 'shared', 'discover'] as const) expect(at(viewHref(scope))).toEqual({ scope, collection: '' });
	expect(at(viewHref('collection', 'a b&c'))).toEqual({ scope: 'collection', collection: 'a b&c' });
});

test('an unknown view falls back to the library', () => {
	expect(at('/?view=collection')).toEqual({ scope: 'library', collection: '' });
	expect(at('/?view=nope')).toEqual({ scope: 'library', collection: '' });
});
