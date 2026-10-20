import { describe, it, expect } from 'vitest';

import { packStoredSnapshots } from './pack-stored-snapshots.js';

describe('packStoredSnapshots', () => {
	it('lays the bodies back to back with their offsets and codec bytes', () => {
		const { bodies, offsets, codecs } = packStoredSnapshots([
			{ body: Buffer.from('ab'), codec: 'none' },
			{ body: Buffer.from('cde'), codec: 'zstd' },
			{ body: Buffer.from(''), codec: 'none' },
		]);
		expect(Buffer.from(bodies).toString()).toBe('abcde');
		expect([...offsets]).toEqual([0, 2, 5, 5]);
		expect([...codecs]).toEqual([0, 1, 0]);
	});

	it('packs an empty batch into empty buffers and the single offset 0', () => {
		const { bodies, offsets, codecs } = packStoredSnapshots([]);
		expect(bodies).toHaveLength(0);
		expect([...offsets]).toEqual([0]);
		expect(codecs).toHaveLength(0);
	});

	it('throws for a codec it does not know', () => {
		expect(() =>
			packStoredSnapshots([{ body: Buffer.from('x'), codec: 'brotli' }]),
		).toThrow('Unknown page_html_blobs.codec: brotli');
	});

	it('throws a RangeError for a batch the u32 offsets cannot address', () => {
		// Only `byteLength` is read before the check, so no 4 GiB is allocated.
		const huge = { byteLength: 3_000_000_000 } as unknown as Uint8Array;
		expect(() =>
			packStoredSnapshots([
				{ body: huge, codec: 'none' },
				{ body: huge, codec: 'none' },
			]),
		).toThrow(RangeError);
	});
});
