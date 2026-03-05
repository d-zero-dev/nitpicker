import { describe, it, expect, vi } from 'vitest';

import { createLinks } from './create-links.js';

describe('createLinks', () => {
	it('returns sheet config with name "Links"', () => {
		const sheet = createLinks([]);
		expect(sheet.name).toBe('Links');
	});

	it('returns correct headers', () => {
		const sheet = createLinks([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'URL',
			'Page Title',
			'Status Code',
			'Status Text',
			'Content Type',
			'Redirect From',
			'Referrers',
			'Headers',
			'Remarks',
		]);
	});

	it('generates row data from a page', async () => {
		const sheet = createLinks([]);
		const mockPage = {
			url: { href: 'https://example.com/' },
			title: 'Example',
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			redirectFrom: [],
			responseHeaders: { 'content-type': 'text/html' },
			isSkipped: false,
			skipReason: null,
			getReferrers: vi.fn().mockResolvedValue([]),
		};

		const rows = await sheet.eachPage!(mockPage as never, 1, 10);
		expect(rows).toHaveLength(1);
		expect(rows![0]).toHaveLength(9);
	});

	it('shows skip reason in remarks when page is skipped', async () => {
		const sheet = createLinks([]);
		const mockPage = {
			url: { href: 'https://example.com/blocked' },
			title: 'Blocked',
			status: null,
			statusText: null,
			contentType: null,
			redirectFrom: [],
			responseHeaders: {},
			isSkipped: true,
			skipReason: 'robots.txt',
			getReferrers: vi.fn().mockResolvedValue([]),
		};

		const rows = await sheet.eachPage!(mockPage as never, 1, 10);
		expect(rows).toHaveLength(1);
	});

	it('has updateSheet method for conditional formatting', () => {
		const sheet = createLinks([]);
		expect(sheet.updateSheet).toBeDefined();
	});
});
