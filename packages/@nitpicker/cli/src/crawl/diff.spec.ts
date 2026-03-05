import { beforeEach, describe, it, expect, vi } from 'vitest';

const mockGetPages = vi.fn();
const mockClose = vi.fn().mockResolvedValue();

vi.mock('@nitpicker/crawler', () => ({
	Archive: {
		open: vi.fn().mockImplementation(() =>
			Promise.resolve({
				getPages: mockGetPages,
				close: mockClose,
			}),
		),
	},
}));

vi.mock('@d-zero/shared/sort-url', () => ({
	sortUrl: vi.fn((urls: string[]) =>
		[...urls]
			.toSorted((a, b) => a.localeCompare(b))
			.map((url) => ({ withoutHashAndAuth: url })),
	),
}));

const mockWriteFile = vi.fn().mockResolvedValue();

vi.mock('node:fs/promises', () => ({
	default: {
		writeFile: (...args: unknown[]) => mockWriteFile(...args),
	},
}));

import { diff } from './diff.js';

/**
 * Creates a mock Page object.
 * @param url - The page URL
 * @param options - Page property overrides
 * @param options.isPage - Whether the page is an HTML page
 * @param options.isExternal - Whether the page is external
 * @param options.status - HTTP status code
 */
function createMockPage(
	url: string,
	options: {
		isPage?: boolean;
		isExternal?: boolean;
		status?: number | null;
	} = {},
) {
	return {
		url: { withoutHashAndAuth: url },
		isPage: () => options.isPage ?? true,
		isExternal: options.isExternal ?? false,
		status: 'status' in options ? options.status : 200,
	};
}

describe('diff', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('アクティブな内部ページの URL を a.txt と b.txt に書き出す', async () => {
		mockGetPages
			.mockResolvedValueOnce([createMockPage('https://example.com/')])
			.mockResolvedValueOnce([createMockPage('https://example.com/about')]);

		await diff('archive-a.nitpicker', 'archive-b.nitpicker');

		expect(mockWriteFile).toHaveBeenCalledWith('a.txt', 'https://example.com/', 'utf8');
		expect(mockWriteFile).toHaveBeenCalledWith(
			'b.txt',
			'https://example.com/about',
			'utf8',
		);
	});

	it('外部ページをフィルタリングする', async () => {
		mockGetPages
			.mockResolvedValueOnce([
				createMockPage('https://example.com/', { isExternal: false }),
				createMockPage('https://external.com/', { isExternal: true }),
			])
			.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/');
		expect(aContent).not.toContain('external.com');
	});

	it('isPage() が false のページをフィルタリングする', async () => {
		mockGetPages
			.mockResolvedValueOnce([
				createMockPage('https://example.com/', { isPage: true }),
				createMockPage('https://example.com/image.png', { isPage: false }),
			])
			.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/');
	});

	it('ステータス 400 以上のページをフィルタリングする', async () => {
		mockGetPages
			.mockResolvedValueOnce([
				createMockPage('https://example.com/', { status: 200 }),
				createMockPage('https://example.com/404', { status: 404 }),
				createMockPage('https://example.com/500', { status: 500 }),
			])
			.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/');
	});

	it('ステータスが null のページをフィルタリングする', async () => {
		mockGetPages
			.mockResolvedValueOnce([
				createMockPage('https://example.com/', { status: 200 }),
				createMockPage('https://example.com/null', { status: null }),
			])
			.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/');
	});

	it('3xx ステータスのページを含める', async () => {
		mockGetPages
			.mockResolvedValueOnce([
				createMockPage('https://example.com/redirect', { status: 301 }),
			])
			.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/redirect');
	});

	it('完了後にアーカイブを close する', async () => {
		mockGetPages.mockResolvedValue([]);

		await diff('a.nitpicker', 'b.nitpicker');

		expect(mockClose).toHaveBeenCalledTimes(2);
	});
});
