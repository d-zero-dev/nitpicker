import { describe, it, expect, vi } from 'vitest';

const packed = vi.hoisted(() => vi.fn());

vi.mock('./pack-stored-snapshots.js', () => ({
	packStoredSnapshots: packed,
}));

const { searchHtmlSnapshots } = await import('./search-html-snapshots.js');

describe('searchHtmlSnapshots with a signal that is already aborted', () => {
	it('rejects with the signal reason without packing the batch', async () => {
		const reason = new Error('aborted first');
		await expect(
			searchHtmlSnapshots({
				pattern: {
					source: 'needle',
					literal: true,
					ignoreCase: false,
					multiLine: false,
					dotAll: false,
				},
				snippetLength: 20,
				snapshots: [{ body: Buffer.from('needle'), codec: 'none' }],
				signal: AbortSignal.abort(reason),
			}),
		).rejects.toBe(reason);
		expect(packed).not.toHaveBeenCalled();
	});
});
