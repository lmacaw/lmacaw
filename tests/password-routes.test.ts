import { expect, test } from 'vitest';
import { GET as list } from '../src/routes/api/v1/items/+server';
import { GET as media } from '../src/routes/api/v1/items/[id]/media/+server';
import { eventFor, listEvent, memberRouteCases } from './fixtures';

const id = '67e55044-10b1-426f-9247-bb680e5fe0c8';
const mediaRoute = '/api/v1/items/[id]/media';

test.each([
	...memberRouteCases(),
	['GET items (shared)', () => list(listEvent(null, '?scope=shared'))],
	['GET items (shared search)', () => list(listEvent(null, '?scope=shared&q=cat'))],
	['GET media', () => media(eventFor(mediaRoute, `/api/v1/items/${id}/media`, null, undefined, id))]
] as const)('returns 401 to an anonymous caller of %s', async (_route, invoke) => {
	const response = await invoke();
	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({ error: 'Unauthorized' });
});
