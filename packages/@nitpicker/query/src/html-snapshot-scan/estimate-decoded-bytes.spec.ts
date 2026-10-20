import { zstdCompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { estimateDecodedBytes } from './estimate-decoded-bytes.js';

/** The zstd frame magic number as a little-endian `u32` (the bytes 28 B5 2F FD). */
const ZSTD_MAGIC = 4_247_762_216;

describe('estimateDecodedBytes', () => {
	it('takes the stored size of an uncompressed snapshot', () => {
		expect(estimateDecodedBytes({ body: Buffer.alloc(40), codec: 'none' })).toBe(40);
	});

	it.each([100, 200, 255, 256, 300, 65_791, 65_792, 70_000, 1_000_000])(
		'reads the decoded size a zstd frame states: %i bytes',
		(size) => {
			const html = Buffer.alloc(size, 'a');
			const body = zstdCompressSync(html);
			expect(estimateDecodedBytes({ body, codec: 'zstd' })).toBe(size);
		},
	);

	it('reads a 4-byte size field', () => {
		const html = Buffer.alloc(5_000_000, 'ab');
		expect(estimateDecodedBytes({ body: zstdCompressSync(html), codec: 'zstd' })).toBe(
			5_000_000,
		);
	});

	it('reads an 8-byte size field', () => {
		// magic, descriptor (size flag 3, single segment), then the size as 8 little-endian bytes.
		const body = Buffer.alloc(13);
		body.writeUInt32LE(ZSTD_MAGIC, 0);
		body[4] = 0b1110_0000;
		body.writeBigUInt64LE(300n, 5);
		expect(estimateDecodedBytes({ body, codec: 'zstd' })).toBe(300);
	});

	it('skips the dictionary id that sits before the size', () => {
		// descriptor: size flag 2 (4 bytes), single segment, dictionary id flag 1 (1 byte).
		const body = Buffer.alloc(11);
		body.writeUInt32LE(ZSTD_MAGIC, 0);
		body[4] = 0b1010_0001;
		body[5] = 7;
		body.writeUInt32LE(1000, 6);
		expect(estimateDecodedBytes({ body, codec: 'zstd' })).toBe(1000);
	});

	it('states the size of the first frame only when frames are concatenated', () => {
		// The judge decodes every frame; the estimate only closes batches, and the
		// first frame's header is all it reads.
		const first = zstdCompressSync(Buffer.alloc(5000, 'a'));
		const second = zstdCompressSync(Buffer.alloc(3000, 'b'));
		expect(
			estimateDecodedBytes({ body: Buffer.concat([first, second]), codec: 'zstd' }),
		).toBe(5000);
	});

	it('assumes a ratio when the frame states no size', () => {
		// A frame without `Frame_Content_Size`: magic, a descriptor with no size flag
		// and no single-segment bit, a window descriptor, then a last empty raw block.
		const body = Buffer.from([40, 181, 47, 253, 0, 0, 1, 0, 0]);
		expect(estimateDecodedBytes({ body, codec: 'zstd' })).toBe(body.byteLength * 8);
	});

	it('assumes a ratio for bytes that are not a zstd frame', () => {
		const body = Buffer.from('not zstd at all');
		expect(estimateDecodedBytes({ body, codec: 'zstd' })).toBe(body.byteLength * 8);
	});

	it('never reports less than the stored size', () => {
		// One byte decodes from a frame of ten.
		const body = zstdCompressSync(Buffer.from('a'));
		expect(estimateDecodedBytes({ body, codec: 'zstd' })).toBe(body.byteLength);
		expect(estimateDecodedBytes({ body: Buffer.alloc(3), codec: 'unknown' })).toBe(3);
	});
});
