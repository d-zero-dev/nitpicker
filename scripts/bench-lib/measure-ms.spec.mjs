import { describe, it, expect } from 'vitest';

import { measureMs } from './measure-ms.mjs';

describe('measureMs', () => {
	it('resolves to the awaited work result and its elapsed time', async () => {
		const { ms, value } = await measureMs(
			() => new Promise((resolve) => setTimeout(() => resolve('done'), 20)),
		);
		expect(value).toBe('done');
		expect(ms).toBeGreaterThanOrEqual(15);
	});

	it('accepts synchronous work', async () => {
		const { value } = await measureMs(() => 42);
		expect(value).toBe(42);
	});

	it('rejects with the error the work throws', async () => {
		await expect(
			measureMs(() => {
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');
	});
});
