import { describe, expect, it } from 'vitest';

import { formatBytes } from './format-bytes.js';

describe('formatBytes', () => {
	it('formats 0 bytes with no decimal', () => {
		expect(formatBytes(0)).toBe('0 B');
	});

	it('formats sub-KB values with no decimal', () => {
		expect(formatBytes(1023)).toBe('1023 B');
	});

	it('formats exactly 1024 bytes as 1.0 KB', () => {
		expect(formatBytes(1024)).toBe('1.0 KB');
	});

	it('formats MB-scale values with one decimal', () => {
		expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB');
	});

	it('formats GB-scale values with one decimal', () => {
		expect(formatBytes(1024 ** 3 * 2)).toBe('2.0 GB');
	});

	it('caps scaling at TB for very large values', () => {
		expect(formatBytes(1024 ** 5)).toBe('1024.0 TB');
	});
});
