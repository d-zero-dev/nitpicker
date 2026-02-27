import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { handleResourceResponse } from './handle-resource-response.js';

describe('handleResourceResponse', () => {
	it('returns isNew: true for a newly seen resource', () => {
		const resources = new Set<string>();
		const resource = {
			url: parseUrl('https://example.com/style.css')!,
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 1024,
			compress: '' as const,
			cdn: '' as const,
			responseHeaders: {},
		};

		const result = handleResourceResponse(resource, resources);

		expect(result.isNew).toBe(true);
		expect(resources.has('https://example.com/style.css')).toBe(true);
	});

	it('returns isNew: false for a duplicate resource', () => {
		const resources = new Set<string>(['https://example.com/style.css']);
		const resource = {
			url: parseUrl('https://example.com/style.css')!,
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 1024,
			compress: '' as const,
			cdn: '' as const,
			responseHeaders: {},
		};

		const result = handleResourceResponse(resource, resources);

		expect(result.isNew).toBe(false);
	});
});
