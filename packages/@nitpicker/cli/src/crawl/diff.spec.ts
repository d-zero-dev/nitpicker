import { Archive } from '@nitpicker/crawler';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const mockGetPagesA = vi.fn();
const mockCloseA = vi.fn().mockResolvedValue();
const mockGetPagesB = vi.fn();
const mockCloseB = vi.fn().mockResolvedValue();

vi.mock('@nitpicker/crawler', () => ({
	Archive: {
		openCached: vi.fn(),
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

const mockLanesUpdate = vi.fn();

vi.mock('@d-zero/dealer', () => ({
	Lanes: vi.fn().mockImplementation(function (this: {
		update: typeof mockLanesUpdate;
		[Symbol.dispose]: ReturnType<typeof vi.fn>;
	}) {
		this.update = mockLanesUpdate;
		this[Symbol.dispose] = vi.fn();
	}),
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
		vi.mocked(Archive.openCached).mockImplementation((filePath) => {
			if (typeof filePath === 'string' && filePath.includes('b')) {
				return Promise.resolve({
					getPages: mockGetPagesB,
					close: mockCloseB,
					[Symbol.asyncDispose]: mockCloseB,
				}) as never;
			}
			return Promise.resolve({
				getPages: mockGetPagesA,
				close: mockCloseA,
				[Symbol.asyncDispose]: mockCloseA,
			}) as never;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('アクティブな内部ページの URL を a.txt と b.txt に書き出す', async () => {
		mockGetPagesA.mockResolvedValueOnce([createMockPage('https://example.com/')]);
		mockGetPagesB.mockResolvedValueOnce([createMockPage('https://example.com/about')]);

		await diff('archive-a.nitpicker', 'archive-b.nitpicker');

		expect(mockWriteFile).toHaveBeenCalledWith('a.txt', 'https://example.com/', 'utf8');
		expect(mockWriteFile).toHaveBeenCalledWith(
			'b.txt',
			'https://example.com/about',
			'utf8',
		);
	});

	it('外部ページをフィルタリングする', async () => {
		mockGetPagesA.mockResolvedValueOnce([
			createMockPage('https://example.com/', { isExternal: false }),
			createMockPage('https://example.net/', { isExternal: true }),
		]);
		mockGetPagesB.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/');
		expect(aContent).not.toContain('example.net');
	});

	it('isPage() が false のページをフィルタリングする', async () => {
		mockGetPagesA.mockResolvedValueOnce([
			createMockPage('https://example.com/', { isPage: true }),
			createMockPage('https://example.com/image.png', { isPage: false }),
		]);
		mockGetPagesB.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/');
	});

	it('ステータス 400 以上のページをフィルタリングする', async () => {
		mockGetPagesA.mockResolvedValueOnce([
			createMockPage('https://example.com/', { status: 200 }),
			createMockPage('https://example.com/404', { status: 404 }),
			createMockPage('https://example.com/500', { status: 500 }),
		]);
		mockGetPagesB.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/');
	});

	it('ステータスが null のページをフィルタリングする', async () => {
		mockGetPagesA.mockResolvedValueOnce([
			createMockPage('https://example.com/', { status: 200 }),
			createMockPage('https://example.com/null', { status: null }),
		]);
		mockGetPagesB.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/');
	});

	it('3xx ステータスのページを含める', async () => {
		mockGetPagesA.mockResolvedValueOnce([
			createMockPage('https://example.com/redirect', { status: 301 }),
		]);
		mockGetPagesB.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe('https://example.com/redirect');
	});

	it('複数ページをソートして改行区切りで書き出す', async () => {
		mockGetPagesA.mockResolvedValueOnce([
			createMockPage('https://example.com/c'),
			createMockPage('https://example.com/a'),
			createMockPage('https://example.com/b'),
		]);
		mockGetPagesB.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		const aContent = mockWriteFile.mock.calls.find(
			(c: unknown[]) => c[0] === 'a.txt',
		)?.[1] as string;
		expect(aContent).toBe(
			'https://example.com/a\nhttps://example.com/b\nhttps://example.com/c',
		);
	});

	it('archiveA と archiveB の両方を close する', async () => {
		mockGetPagesA.mockResolvedValueOnce([]);
		mockGetPagesB.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		expect(mockCloseA).toHaveBeenCalledTimes(1);
		expect(mockCloseB).toHaveBeenCalledTimes(1);
	});

	it('Archive.openCached にファイルパスと onExtractProgress を渡す（issue #294: 読み取り専用・キャッシュ経由に変更）', async () => {
		mockGetPagesA.mockResolvedValueOnce([]);
		mockGetPagesB.mockResolvedValueOnce([]);

		await diff('first.nitpicker', 'second-b.nitpicker');

		expect(Archive.openCached).toHaveBeenCalledWith(
			'first.nitpicker',
			null,
			expect.any(Function),
		);
		expect(Archive.openCached).toHaveBeenCalledWith(
			'second-b.nitpicker',
			null,
			expect.any(Function),
		);
	});

	it('抽出フェーズと比較フェーズのラベルを Lanes に表示する（issue #294）', async () => {
		mockGetPagesA.mockResolvedValueOnce([]);
		mockGetPagesB.mockResolvedValueOnce([]);

		await diff('a.nitpicker', 'b.nitpicker');

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Extracting archive A%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Extracting archive B%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Comparing pages%dots%',
		);
	});

	it('--silent のときは Lanes を作らない（issue #294）', async () => {
		mockGetPagesA.mockResolvedValueOnce([]);
		mockGetPagesB.mockResolvedValueOnce([]);

		const { Lanes } = await import('@d-zero/dealer');
		await diff('a.nitpicker', 'b.nitpicker', { silent: true });

		expect(Lanes).not.toHaveBeenCalled();
	});
});
