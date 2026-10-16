import { describe, it, expect } from 'vitest';

import { normalizeBodyHash } from './normalize-body-hash.js';

describe('normalizeBodyHash', () => {
	it('reads an ArrayBuffer as the same bytes', () => {
		const buffer = Uint8Array.of(1, 2, 3).buffer;
		expect([...normalizeBodyHash(buffer)!]).toStrictEqual([1, 2, 3]);
	});

	it('returns a Uint8Array as it is', () => {
		const bytes = Uint8Array.of(4, 5);
		expect(normalizeBodyHash(bytes)).toBe(bytes);
	});

	it('returns a Buffer as it is', () => {
		const bytes = Buffer.from([6, 7]);
		expect(normalizeBodyHash(bytes)).toBe(bytes);
	});

	it('returns null for a NULL cell', () => {
		expect(normalizeBodyHash(null)).toBeNull();
	});

	it('reads an empty ArrayBuffer as no bytes, not as NULL', () => {
		expect(normalizeBodyHash(new ArrayBuffer(0))).toHaveLength(0);
	});
});
