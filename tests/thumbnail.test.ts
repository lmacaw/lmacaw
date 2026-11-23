import { expect, test } from 'vitest';
import { fitWithin } from '$lib/thumbnail';

test.each([
	[1000, 500, 768, 384],
	[500, 1000, 384, 768],
	[300, 200, 300, 200],
	[20000, 1, 768, 1],
	[1, 20000, 1, 768]
])('fits %i × %i within 768 px as %i × %i', (width, height, fittedWidth, fittedHeight) => {
	expect(fitWithin(width, height)).toEqual({ width: fittedWidth, height: fittedHeight });
});
