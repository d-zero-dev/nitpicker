import { describe, it, expect, vi } from 'vitest';

import { createResourcesRelationalTable } from './create-resources-relational-table.js';

describe('createResourcesRelationalTable', () => {
	it('returns sheet config with correct name', () => {
		const sheet = createResourcesRelationalTable([]);
		expect(sheet.name).toBe('Resources Relational Table');
	});

	it('returns correct headers', () => {
		const sheet = createResourcesRelationalTable([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'Referred Page (From)',
			'Resource (To)',
			'Resource Status Code',
			'Resource Status Text',
			'Resource Content Type',
			'Resource Size',
		]);
	});

	it('generates rows from resource referrers', async () => {
		const sheet = createResourcesRelationalTable([]);
		const mockResource = {
			url: 'https://cdn.example.com/app.js',
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 5000,
			getReferrers: vi
				.fn()
				.mockResolvedValue(['https://example.com/', 'https://example.com/about']),
		};

		const rows = await sheet.eachResource!(mockResource as never);
		expect(rows).toHaveLength(2);
		expect(rows![0]).toHaveLength(6);
	});

	it('returns empty rows for resource with no referrers', async () => {
		const sheet = createResourcesRelationalTable([]);
		const mockResource = {
			url: 'https://cdn.example.com/unused.css',
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 100,
			getReferrers: vi.fn().mockResolvedValue([]),
		};

		const rows = await sheet.eachResource!(mockResource as never);
		expect(rows).toHaveLength(0);
	});

	it('has updateSheet method for conditional formatting', () => {
		const sheet = createResourcesRelationalTable([]);
		expect(sheet.updateSheet).toBeDefined();
	});
});
