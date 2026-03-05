import { describe, it, expect, vi } from 'vitest';

import { createImageList } from './create-image-list.js';

describe('createImageList', () => {
	it('returns sheet config with name "Images"', () => {
		const sheet = createImageList([]);
		expect(sheet.name).toBe('Images');
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

	it('skips external pages', async () => {
		const sheet = createImageList([]);
		const mockPage = {
			isInternalPage: vi.fn().mockReturnValue(false),
			url: { href: 'https://external.com/' },
		};

		const result = await sheet.eachPage!(mockPage as never, 0, 1);
		expect(result).toBeUndefined();
	});

	it('skips pages without HTML', async () => {
		const sheet = createImageList([]);
		const mockPage = {
			isInternalPage: vi.fn().mockReturnValue(true),
			url: { href: 'https://example.com/' },
			getHtml: vi.fn().mockResolvedValue(null),
		};

		const result = await sheet.eachPage!(mockPage as never, 0, 1);
		expect(result).toBeUndefined();
	});

	it('extracts image data from page HTML', async () => {
		const sheet = createImageList([]);
		const mockPage = {
			isInternalPage: vi.fn().mockReturnValue(true),
			url: { href: 'https://example.com/' },
			getHtml: vi
				.fn()
				.mockResolvedValue(
					'<html><body><img src="https://example.com/photo.jpg" alt="Photo" width="640" height="480" /></body></html>',
				),
		};

		const rows = await sheet.eachPage!(mockPage as never, 0, 1);
		expect(rows).toHaveLength(1);
		expect(rows![0]).toHaveLength(8);
	});

	it('returns empty array for pages with no images', async () => {
		const sheet = createImageList([]);
		const mockPage = {
			isInternalPage: vi.fn().mockReturnValue(true),
			url: { href: 'https://example.com/' },
			getHtml: vi.fn().mockResolvedValue('<html><body><p>No images</p></body></html>'),
		};

		const rows = await sheet.eachPage!(mockPage as never, 0, 1);
		expect(rows).toHaveLength(0);
	});

	it('extracts multiple images from a single page', async () => {
		const sheet = createImageList([]);
		const mockPage = {
			isInternalPage: vi.fn().mockReturnValue(true),
			url: { href: 'https://example.com/' },
			getHtml: vi.fn().mockResolvedValue(`
				<html><body>
					<img src="a.jpg" alt="A" />
					<img src="b.jpg" alt="B" />
					<img src="c.jpg" alt="C" />
				</body></html>
			`),
		};

		const rows = await sheet.eachPage!(mockPage as never, 0, 1);
		expect(rows).toHaveLength(3);
	});
});
