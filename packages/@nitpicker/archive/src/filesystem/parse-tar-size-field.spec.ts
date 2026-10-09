import { describe, it, expect } from 'vitest';

import { parseTarSizeField } from './parse-tar-size-field.js';

describe('parseTarSizeField', () => {
	it('parses a NUL-terminated octal size (the common case)', () => {
		expect(parseTarSizeField(Buffer.from('00000000004\0', 'latin1'))).toBe(4);
	});

	it('parses a space-padded octal size with no NUL terminator', () => {
		expect(parseTarSizeField(Buffer.from(' 00000000010', 'latin1'))).toBe(8);
	});

	it('treats an all-blank field as size 0', () => {
		expect(parseTarSizeField(Buffer.alloc(12))).toBe(0);
	});

	it('decodes a GNU base-256 size when the high bit of the first byte is set', () => {
		// 0x80 marker | 0x00... | 0x01 0x00 → 256
		const field = Buffer.alloc(12);
		field[0] = 0x80;
		field[11] = 0x00;
		field[10] = 0x01;
		expect(parseTarSizeField(field)).toBe(256);
	});

	it('decodes a GNU base-256 size that fits in a single trailing byte', () => {
		const field = Buffer.alloc(12);
		field[0] = 0x80;
		field[11] = 42;
		expect(parseTarSizeField(field)).toBe(42);
	});

	it('returns null for a non-octal, non-base-256 field', () => {
		expect(parseTarSizeField(Buffer.from('not-a-size!!', 'latin1'))).toBeNull();
	});

	it('returns null for an empty buffer', () => {
		expect(parseTarSizeField(Buffer.alloc(0))).toBeNull();
	});
});
