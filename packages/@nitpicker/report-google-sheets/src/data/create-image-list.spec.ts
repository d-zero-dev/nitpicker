import type { Page } from '@nitpicker/crawler';

import { Cell } from '@d-zero/google-sheets';
import { describe, it, expect, vi } from 'vitest';

import { createImageList } from './create-image-list.js';

/**
 * Creates a mock Page object with sensible defaults for testing.
 * @param overrides - Properties to override on the default mock page.
 * @returns A mock Page instance cast via `as never`.
 */
function createMockPage(overrides: Partial<Record<string, unknown>> = {}): Page {
	return {
		url: { href: 'https://example.com/' },
		title: 'Example Page',
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		isExternal: false,
		isTarget: true,
		isSkipped: false,
		redirectFrom: [],
		isInternalPage: () => true,
		isPage: () => true,
		getAnchors: vi.fn().mockResolvedValue([]),
		getReferrers: vi.fn().mockResolvedValue([]),
		getHtml: vi.fn().mockResolvedValue(null),
		...overrides,
	} as never;
}

/**
 * Extracts the primitive value from a Cell by calling `provide()` and reading `userEnteredValue`.
 * @param cell - A Cell object with a `provide` method.
 * @param cell.provide
 * @returns The string, number, boolean, or formula value held by the cell.
 */
function cellValue(cell: {
	provide: (n?: number) => { userEnteredValue: Record<string, unknown> };
}) {
	const provided = cell.provide();
	return (
		provided.userEnteredValue.stringValue ??
		provided.userEnteredValue.numberValue ??
		provided.userEnteredValue.boolValue ??
		provided.userEnteredValue.formulaValue ??
		''
	);
}

describe('createImageList', () => {
	it('returns sheet config with name "Images"', () => {
		const sheet = createImageList([]);
		expect(sheet.name).toBe('Images');
	});

	it('does not opt into bufferRows so rows stream out incrementally', () => {
		// No lazy cells — streaming keeps peak memory bounded when each page
		// emits multiple image rows.
		const sheet = createImageList([]);
		expect(sheet.bufferRows).toBeFalsy();
	});

	it('returns only eager cells from eachPage (streaming requires no lazy thunks)', async () => {
		// See create-links.spec.ts for the rationale.
		const page = createMockPage({
			getHtml: vi
				.fn()
				.mockResolvedValue(
					'<html><body><img src="/a.png" alt="A" width="100" height="50"></body></html>',
				),
		});
		const sheet = createImageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);
		expect(rows).toBeTruthy();
		expect(rows!.length).toBeGreaterThan(0);
		for (const row of rows!) {
			for (const cell of row) {
				expect(cell.provide).toBe(Cell.prototype.provide);
			}
		}
	});

	it('returns correct headers', () => {
		const sheet = createImageList([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'Page URL',
			'Image path (src)',
			'Image Path (currentSrc)',
			'Alternative Text',
			'Displayed Width',
			'Displayed Height',
			'Lazy Loading',
			'Source Code',
		]);
	});

	it('extracts img elements from HTML', async () => {
		const html = `
			<html><body>
				<img src="https://example.com/img1.png" alt="Image 1" width="100" height="50">
				<img src="https://example.com/img2.jpg" alt="Image 2" width="200" height="150">
			</body></html>
		`;
		const page = createMockPage({
			getHtml: vi.fn().mockResolvedValue(html),
		});

		const sheet = createImageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(rows).toHaveLength(2);
		expect(rows![0]).toHaveLength(8);
		expect(rows![1]).toHaveLength(8);
	});

	it('includes page URL in each row', async () => {
		const html = '<html><body><img src="test.png" alt="test"></body></html>';
		const page = createMockPage({
			url: { href: 'https://example.com/page' },
			getHtml: vi.fn().mockResolvedValue(html),
		});

		const sheet = createImageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][0])).toBe('https://example.com/page');
	});

	it('extracts alt text correctly', async () => {
		const html =
			'<html><body><img src="test.png" alt="Descriptive alt text"></body></html>';
		const page = createMockPage({
			getHtml: vi.fn().mockResolvedValue(html),
		});

		const sheet = createImageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][3])).toBe('Descriptive alt text');
	});

	it('detects lazy loading attribute', async () => {
		const html = `
			<html><body>
				<img src="lazy.png" alt="" loading="lazy">
				<img src="eager.png" alt="" loading="eager">
			</body></html>
		`;
		const page = createMockPage({
			getHtml: vi.fn().mockResolvedValue(html),
		});

		const sheet = createImageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][6])).toBe(true);
		expect(cellValue(rows![1][6])).toBe(false);
	});

	it('includes img outerHTML in source code column', async () => {
		const html = '<html><body><img src="test.png" alt="test" class="hero"></body></html>';
		const page = createMockPage({
			getHtml: vi.fn().mockResolvedValue(html),
		});

		const sheet = createImageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		const sourceCode = cellValue(rows![0][7]);
		expect(sourceCode).toBe('<img src="test.png" alt="test" class="hero">');
	});

	it('skips external pages', async () => {
		const page = createMockPage({
			isInternalPage: () => false,
			getHtml: vi
				.fn()
				.mockResolvedValue('<html><body><img src="test.png"></body></html>'),
		});

		const sheet = createImageList([]);
		const result = await sheet.eachPage!(page, 1, 1, null);

		expect(result).toBeUndefined();
	});

	it('skips pages with null HTML', async () => {
		const page = createMockPage({
			getHtml: vi.fn().mockResolvedValue(null),
		});

		const sheet = createImageList([]);
		const result = await sheet.eachPage!(page, 1, 1, null);

		expect(result).toBeUndefined();
	});

	it('returns empty array for pages with no images', async () => {
		const html = '<html><body><p>No images here</p></body></html>';
		const page = createMockPage({
			getHtml: vi.fn().mockResolvedValue(html),
		});

		const sheet = createImageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(rows).toEqual([]);
	});

	it('resolves relative src using page URL as JSDOM base', async () => {
		const html = '<html><body><img src="/images/photo.png" alt="Photo"></body></html>';
		const page = createMockPage({
			url: { href: 'https://example.com/page/' },
			getHtml: vi.fn().mockResolvedValue(html),
		});

		const sheet = createImageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		// JSDOM resolves relative src against the base URL
		expect(cellValue(rows![0][1])).toBe('https://example.com/images/photo.png');
	});

	it('extracts width and height attributes', async () => {
		const html =
			'<html><body><img src="test.png" alt="" width="300" height="200"></body></html>';
		const page = createMockPage({
			getHtml: vi.fn().mockResolvedValue(html),
		});

		const sheet = createImageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][4])).toBe(300);
		expect(cellValue(rows![0][5])).toBe(200);
	});
});
