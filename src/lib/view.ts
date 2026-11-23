import type { Scope } from './types';

// The current view lives in the URL, so reload, Back and links to "/" all land on the right view.
const scopes: Scope[] = ['library', 'favorites', 'shared', 'discover'];

export function viewFromUrl(url: URL): { scope: Scope; collection: string } {
	const collection = url.searchParams.get('collection');
	if (collection) return { scope: 'collection', collection };
	const view = url.searchParams.get('view') as Scope | null;
	return { scope: view && scopes.includes(view) ? view : 'library', collection: '' };
}

export function viewHref(scope: Scope, collection = ''): string {
	if (scope === 'collection') return `/?${new URLSearchParams({ collection })}`;
	return scope === 'library' ? '/' : `/?${new URLSearchParams({ view: scope })}`;
}
