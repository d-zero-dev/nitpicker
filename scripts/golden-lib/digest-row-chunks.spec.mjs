import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';

import { digestRowChunks } from './digest-row-chunks.mjs';

/**
 * @param {unknown[]} rows - Rows to hash.
 * @returns {string} SHA-256 over their JSON lines.
 */
function sha(rows) {
	const hash = createHash('sha256');
	for (const row of rows) {
		hash.update(`${JSON.stringify(row)}\n`);
	}
	return hash.digest('hex');
}

/**
 * @param {unknown} value - The only column of a one-row table.
 * @returns {Promise<string | undefined>} The digest of that row.
 */
async function digestOf(value) {
	const entries = await digestRowChunks([{ a: value }], 10);
	return entries.get('chunk:0');
}

describe('digestRowChunks', () => {
	it('counts rows and keys each chunk by its first row index', async () => {
		const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
		const entries = await digestRowChunks(rows, 2);
		expect([...entries.keys()]).toEqual(['rows', 'chunk:0', 'chunk:2']);
		expect(entries.get('rows')).toBe('3');
		expect(entries.get('chunk:0')).toBe(sha(rows.slice(0, 2)));
		expect(entries.get('chunk:2')).toBe(sha(rows.slice(2)));
	});

	it('accepts an async iterable', async () => {
		/**
		 * @yields {{ a: number }} Two rows.
		 */
		async function* generate() {
			yield { a: 1 };
			yield { a: 2 };
		}
		const entries = await digestRowChunks(generate(), 10);
		expect(entries.get('rows')).toBe('2');
		expect(entries.get('chunk:0')).toBe(sha([{ a: 1 }, { a: 2 }]));
	});

	it('reports an empty table as zero rows with no chunk', async () => {
		const entries = await digestRowChunks([], 10);
		expect([...entries]).toEqual([['rows', '0']]);
	});

	it('changes only the chunk that contains a changed row', async () => {
		const before = await digestRowChunks([{ a: 1 }, { a: 2 }, { a: 3 }], 2);
		const after = await digestRowChunks([{ a: 1 }, { a: 2 }, { a: 9 }], 2);
		expect(after.get('chunk:0')).toBe(before.get('chunk:0'));
		expect(after.get('chunk:2')).not.toBe(before.get('chunk:2'));
	});

	it('is sensitive to row order', async () => {
		const forward = await digestRowChunks([{ a: 1 }, { a: 2 }], 10);
		const reversed = await digestRowChunks([{ a: 2 }, { a: 1 }], 10);
		expect(reversed.get('chunk:0')).not.toBe(forward.get('chunk:0'));
	});

	it('rejects a non-positive chunk size', async () => {
		await expect(digestRowChunks([], 0)).rejects.toThrow(RangeError);
	});

	it('tells apart values that JSON.stringify would write the same way', async () => {
		const digests = await Promise.all([
			digestOf(null),
			digestOf(Number.NaN),
			digestOf(Number.POSITIVE_INFINITY),
			digestOf(Number.NEGATIVE_INFINITY),
			digestOf(),
			digestOf('NaN'),
		]);
		expect(new Set(digests).size).toBe(digests.length);
	});

	it('hashes a BigInt instead of throwing, and not as the number or string it looks like', async () => {
		const big = await digestOf(12_345_678_901_234_567_890n);
		expect(big).toMatch(/^[0-9a-f]{64}$/);
		expect(big).not.toBe(await digestOf(Number('12345678901234567890')));
		expect(big).not.toBe(await digestOf('12345678901234567890'));
	});

	it('hashes binary values by content, and not as the array or string they look like', async () => {
		const bytes = await digestOf(Buffer.from([1, 2, 3]));
		expect(bytes).toBe(await digestOf(new Uint8Array([1, 2, 3])));
		expect(bytes).not.toBe(await digestOf(Buffer.from([1, 2, 4])));
		expect(bytes).not.toBe(await digestOf([1, 2, 3]));
		expect(bytes).not.toBe(await digestOf('010203'));
	});

	it('keeps the digest of plain rows exactly as JSON lines (so existing dumps stay valid)', async () => {
		const entries = await digestRowChunks([{ a: 1, b: 'x', c: null }], 10);
		expect(entries.get('chunk:0')).toBe(sha([{ a: 1, b: 'x', c: null }]));
	});
});
