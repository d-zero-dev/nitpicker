import { describe, it, expect, vi } from 'vitest';

const packed = vi.hoisted(() => vi.fn());

vi.mock('./pack-stored-snapshots.js', () => ({
	packStoredSnapshots: packed,
}));

const { matchSelectorSnapshots } = await import('./match-selector-snapshots.js');

describe('matchSelectorSnapshots with a signal that is already aborted', () => {
	it('rejects with the signal reason without packing the batch', async () => {
		const reason = new Error('aborted first');
		await expect(
			matchSelectorSnapshots({
				plan: { alternatives: [], needsChildIndex: false, needsTypeIndex: false },
				snapshots: [{ body: Buffer.from('<img>'), codec: 'none' }],
				signal: AbortSignal.abort(reason),
			}),
		).rejects.toBe(reason);
		expect(packed).not.toHaveBeenCalled();
	});
});
