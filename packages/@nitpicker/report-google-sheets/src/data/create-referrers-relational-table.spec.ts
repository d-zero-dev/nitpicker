import { describe, it, expect, vi } from 'vitest';

import { createReferrersRelationalTable } from './create-referrers-relational-table.js';

describe('createReferrersRelationalTable', () => {
	it('returns sheet config with correct name', () => {
		const sheet = createReferrersRelationalTable([]);
		expect(sheet.name).toBe('Referrers Relational Table');
	});

	it('returns correct headers', () => {
		const sheet = createReferrersRelationalTable([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'Link (To)',
			'Referrer (From)',
			'Referrer Content',
			'Link Status Code',
			'Link Status Text',
			'Link Content Type',
		]);
	});

	it('generates rows from page referrers', async () => {
		const sheet = createReferrersRelationalTable([]);
		const mockPage = {
			url: { href: 'https://example.com/page' },
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			getReferrers: vi.fn().mockResolvedValue([
				{
					textContent: 'Home Link',
					url: 'https://example.com/',
					hash: '',
					through: 'https://example.com/page',
				},
			]),
		};

		const rows = await sheet.eachPage!(mockPage as never, 1, 10);
		expect(rows).toHaveLength(1);
		expect(rows![0]).toHaveLength(6);
	});

	it('returns empty rows for pages with no referrers', async () => {
		const sheet = createReferrersRelationalTable([]);
		const mockPage = {
			url: { href: 'https://example.com/orphan' },
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			getReferrers: vi.fn().mockResolvedValue([]),
		};

		const rows = await sheet.eachPage!(mockPage as never, 1, 10);
		expect(rows).toHaveLength(0);
	});

	it('has updateSheet method for conditional formatting', () => {
		const sheet = createReferrersRelationalTable([]);
		expect(sheet.updateSheet).toBeDefined();
	});
});
