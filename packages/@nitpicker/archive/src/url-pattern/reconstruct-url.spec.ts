import { describe, it, expect } from 'vitest';

import { decomposeUrl } from './decompose-url.js';
import { reconstructUrl } from './reconstruct-url.js';

describe('reconstructUrl', () => {
	it('replaces a path segment token', () => {
		const decomposed = decomposeUrl('//example.com/page/3')!;
		const result = reconstructUrl(decomposed, 1, '4');
		expect(result).toBe('//example.com/page/4');
	});

	it('replaces a query value token', () => {
		const decomposed = decomposeUrl('//example.com/list?p=2&sort=name')!;
		const result = reconstructUrl(decomposed, 1, '3');
		expect(result).toBe('//example.com/list?p=3&sort=name');
	});

	it('preserves protocol', () => {
		const decomposed = decomposeUrl('https://example.com/page/1')!;
		const result = reconstructUrl(decomposed, 1, '2');
		expect(result).toBe('https://example.com/page/2');
	});

	it('encodes special characters in query keys and values', () => {
		const decomposed = decomposeUrl('//example.com/search?q=hello&lang=en')!;
		// queryKeys are sorted: ['lang', 'q'], tokenIndex 1 replaces lang's value
		const result = reconstructUrl(decomposed, 1, 'a&b=c');
		expect(result).toContain('lang=a%26b%3Dc');
	});

	it('encodes unicode characters in query values', () => {
		const decomposed = decomposeUrl('//example.com/search?q=test')!;
		const result = reconstructUrl(decomposed, 1, '日本語');
		expect(result).toContain(encodeURIComponent('日本語'));
	});
});
