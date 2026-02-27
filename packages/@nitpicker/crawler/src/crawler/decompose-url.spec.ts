import { describe, it, expect } from 'vitest';

import { decomposeUrl } from './decompose-url.js';

describe('decomposeUrl', () => {
	it('decomposes a full URL with path and query', () => {
		const result = decomposeUrl('https://example.com/page/2?sort=name&p=1');
		expect(result).not.toBeNull();
		expect(result!.host).toBe('example.com');
		expect(result!.pathSegments).toEqual(['page', '2']);
		expect(result!.queryKeys).toEqual(['p', 'sort']);
		expect(result!.queryValues).toEqual(['1', 'name']);
		expect(result!.protocol).toBe('https:');
	});

	it('decomposes a protocol-agnostic URL', () => {
		const result = decomposeUrl('//example.com/page/1');
		expect(result).not.toBeNull();
		expect(result!.host).toBe('example.com');
		expect(result!.pathSegments).toEqual(['page', '1']);
		expect(result!.protocol).toBe('');
	});

	it('decomposes URL with port', () => {
		const result = decomposeUrl('//example.com:8080/page/1');
		expect(result).not.toBeNull();
		expect(result!.host).toBe('example.com:8080');
	});

	it('returns null for invalid URL format', () => {
		expect(decomposeUrl('not-a-url')).toBeNull();
	});

	it('handles URL with query only (no path)', () => {
		const result = decomposeUrl('//example.com?offset=0');
		expect(result).not.toBeNull();
		expect(result!.pathSegments).toEqual([]);
		expect(result!.queryKeys).toEqual(['offset']);
		expect(result!.queryValues).toEqual(['0']);
	});

	it('handles URL with no path and no query', () => {
		const result = decomposeUrl('//example.com');
		expect(result).not.toBeNull();
		expect(result!.pathSegments).toEqual([]);
		expect(result!.queryKeys).toEqual([]);
	});
});
