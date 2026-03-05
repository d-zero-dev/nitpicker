import { describe, it, expect, vi } from 'vitest';

import { createResources } from './create-resources.js';

describe('createResources', () => {
	it('returns sheet config with name "Resources"', () => {
		const sheet = createResources([]);
		expect(sheet.name).toBe('Resources');
	});

	it('returns correct headers', () => {
		const sheet = createResources([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'URL',
			'Status Code',
			'Status Text',
			'Content Type',
			'Content Length',
			'Referrers',
		]);
	});

	it('generates row data from a resource with referrers', async () => {
		const sheet = createResources([]);
		const mockResource = {
			url: 'https://cdn.example.com/style.css',
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 1024,
			getReferrers: vi
				.fn()
				.mockResolvedValue(['https://example.com/', 'https://example.com/about']),
		};

		const rows = await sheet.eachResource!(mockResource as never);
		expect(rows).toHaveLength(1);
		expect(rows![0]).toHaveLength(6);
		expect(mockResource.getReferrers).toHaveBeenCalledOnce();
	});
});
