import { expect, test } from 'vitest';
import { appendPage, leavesView, updateLocal } from '../src/lib/paging';

test('appends a page without repeating items already shown or within the page', () => {
	const shown = [{ id: 'a' }, { id: 'b' }];
	expect(appendPage(shown, [{ id: 'b' }, { id: 'c' }, { id: 'c' }]).map((item) => item.id)).toEqual(['a', 'b', 'c']);
	expect(appendPage([], [{ id: 'a' }])).toEqual([{ id: 'a' }]);
	expect(shown).toHaveLength(2);
});

test('updates or removes one shown item without touching the rest', () => {
	const shown = [{ id: 'a', favorite: false }, { id: 'b', favorite: false }];
	expect(updateLocal(shown, 'b', { favorite: true })).toEqual([{ id: 'a', favorite: false }, { id: 'b', favorite: true }]);
	expect(updateLocal(shown, 'a', null)).toEqual([{ id: 'b', favorite: false }]);
	expect(updateLocal(shown, 'missing', null)).toEqual(shown);
	expect(shown[1].favorite).toBe(false);
});

test('an item leaves Favorites when unfavorited and Shared when unshared, nowhere else', () => {
	expect(leavesView('favorites', { favorite: false })).toBe(true);
	expect(leavesView('shared', { shared: false })).toBe(true);
	expect(leavesView('favorites', { favorite: true })).toBe(false);
	expect(leavesView('library', { favorite: false, shared: false })).toBe(false);
	expect(leavesView('favorites', { description: 'x' } as never)).toBe(false);
});
