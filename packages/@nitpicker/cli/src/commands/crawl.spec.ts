import type { CrawlerOrchestrator as OrchestratorType } from '@nitpicker/crawler';

import { beforeEach, describe, it, expect, vi } from 'vitest';

const mockCrawling = vi.fn();
const mockWrite = vi.fn();
const mockGarbageCollect = vi.fn();

vi.mock('@nitpicker/crawler', () => ({
	CrawlerOrchestrator: {
		crawling: mockCrawling,
	},
}));

vi.mock('../crawl/event-assignments.js', () => ({
	eventAssignments: vi.fn().mockResolvedValue(),
}));

vi.mock('../crawl/debug.js', () => ({
	log: vi.fn(),
	verbosely: vi.fn(),
}));

/**
 * Minimal flags matching the shape produced by the CLI parser.
 * @param overrides
 */
function createFlags(overrides: Record<string, unknown> = {}) {
	return {
		resume: undefined,
		interval: undefined,
		image: true,
		fetchExternal: true,
		parallels: undefined,
		recursive: true,
		scope: undefined,
		exclude: undefined,
		excludeKeyword: undefined,
		excludeUrl: undefined,
		disableQueries: undefined,
		imageFileSizeThreshold: undefined,
		single: undefined,
		maxExcludedDepth: undefined,
		retry: 3,
		list: undefined,
		listFile: undefined,
		userAgent: undefined,
		ignoreRobots: undefined,
		output: undefined,
		verbose: undefined,
		silent: undefined,
		diff: undefined,
		...overrides,
	};
}

describe('startCrawl', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		const fakeOrchestrator = {
			write: mockWrite.mockResolvedValue(),
			garbageCollect: mockGarbageCollect,
			archive: { filePath: '/tmp/test.nitpicker' },
		} as unknown as OrchestratorType;

		mockCrawling.mockImplementation((_urls, _opts, cb) => {
			cb?.(fakeOrchestrator, { baseUrl: 'https://example.com' });
			return Promise.resolve(fakeOrchestrator);
		});
	});

	it('--single フラグが true の場合、recursive: false で CrawlerOrchestrator.crawling を呼び出す', async () => {
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(['https://example.com'], createFlags({ single: true }) as never);

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ recursive: false }),
			expect.any(Function),
		);
	});

	it('--single フラグが未指定の場合、recursive はフラグの値がそのまま渡される', async () => {
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(['https://example.com'], createFlags({ recursive: true }) as never);

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ recursive: true }),
			expect.any(Function),
		);
	});

	it('--list モードでも recursive: false になる', async () => {
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(
			['https://example.com'],
			createFlags({ list: ['https://example.com/a'] }) as never,
		);

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ recursive: false, list: true }),
			expect.any(Function),
		);
	});
});
