import { expect, test } from 'vitest';
import { appendPage } from '../src/lib/paging';

test('appends a page without repeating items already shown or within the page', () => {
	const shown = [{ id: 'a' }, { id: 'b' }];
	expect(appendPage(shown, [{ id: 'b' }, { id: 'c' }, { id: 'c' }]).map((item) => item.id)).toEqual(['a', 'b', 'c']);
	expect(appendPage([], [{ id: 'a' }])).toEqual([{ id: 'a' }]);
	expect(shown).toHaveLength(2);
});
