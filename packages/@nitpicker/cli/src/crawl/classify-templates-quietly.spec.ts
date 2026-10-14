import type Archive from '@nitpicker/archive/archive';

import { describe, it, expect, vi, afterEach } from 'vitest';

const mockClassifyArchivePageTemplates = vi.fn();

vi.mock(
	'@nitpicker/archive/template-classification/classify-archive-page-templates',
	() => ({
		classifyArchivePageTemplates: mockClassifyArchivePageTemplates,
	}),
);

const fakeArchive = {} as Archive;

describe('classifyTemplatesQuietly', () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it('delegates to classifyArchivePageTemplates with the archive and an onProgress hook', async () => {
		mockClassifyArchivePageTemplates.mockResolvedValue({
			classifiedPageCount: 0,
			templateCount: 0,
			sampledBlocks: [],
		});
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');

		await classifyTemplatesQuietly(fakeArchive);

		expect(mockClassifyArchivePageTemplates).toHaveBeenCalledWith(fakeArchive, {
			onProgress: expect.any(Function),
		});
	});

	it('passes the --template-memory-budget flag, MiB converted to bytes', async () => {
		mockClassifyArchivePageTemplates.mockResolvedValue({
			classifiedPageCount: 0,
			templateCount: 0,
			sampledBlocks: [],
		});
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');

		await classifyTemplatesQuietly(fakeArchive, { templateMemoryBudget: 512 });

		expect(mockClassifyArchivePageTemplates).toHaveBeenCalledWith(fakeArchive, {
			memoryBudget: 536_870_912,
			onProgress: expect.any(Function),
		});
	});

	it('falls back to NITPICKER_TEMPLATE_MEMORY_BUDGET when the flag is omitted', async () => {
		vi.stubEnv('NITPICKER_TEMPLATE_MEMORY_BUDGET', '64');
		mockClassifyArchivePageTemplates.mockResolvedValue({
			classifiedPageCount: 0,
			templateCount: 0,
			sampledBlocks: [],
		});
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');

		await classifyTemplatesQuietly(fakeArchive);
		vi.unstubAllEnvs();

		expect(mockClassifyArchivePageTemplates).toHaveBeenCalledWith(fakeArchive, {
			memoryBudget: 67_108_864,
			onProgress: expect.any(Function),
		});
	});

	it('reports an invalid budget as a failure without classifying', async () => {
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');
		const onProgress = vi.fn();

		const result = await classifyTemplatesQuietly(fakeArchive, {
			onProgress,
			templateMemoryBudget: -1,
		});

		expect(result).toBe(
			'Invalid template memory budget (--template-memory-budget -1): expected a non-negative number of MiB',
		);
		expect(mockClassifyArchivePageTemplates).not.toHaveBeenCalled();
	});

	it('counts the blocks sampled in the summary, by why they were', async () => {
		mockClassifyArchivePageTemplates.mockResolvedValue({
			classifiedPageCount: 40_000,
			templateCount: 3,
			sampledBlocks: [
				{
					blockKey: 'path:a',
					pageCount: 30_000,
					pairBytes: 3_599_940_000,
					reason: 'table-over-budget',
				},
			],
		});
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');
		const onProgress = vi.fn();

		await classifyTemplatesQuietly(fakeArchive, { onProgress });

		expect(onProgress).toHaveBeenLastCalledWith(
			'40,000 page(s) in 3 template(s), 1 block(s) sampled (1 over the memory budget)',
		);
	});

	it('says a block was sampled for its pages, not for the budget, when that is why', async () => {
		mockClassifyArchivePageTemplates.mockResolvedValue({
			classifiedPageCount: 40_000,
			templateCount: 3,
			sampledBlocks: [
				{
					blockKey: 'path:a',
					pageCount: 12_000,
					pairBytes: 575_952_000,
					reason: 'pages-over-limit',
				},
				{
					blockKey: 'path:b',
					pageCount: 30_000,
					pairBytes: 3_599_940_000,
					reason: 'table-over-budget',
				},
			],
		});
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');
		const onProgress = vi.fn();

		await classifyTemplatesQuietly(fakeArchive, { onProgress });

		expect(onProgress).toHaveBeenLastCalledWith(
			'40,000 page(s) in 3 template(s), 2 block(s) sampled (1 over the memory budget, 1 over the page limit)',
		);
	});

	it('formats progress events through the injected callback and ends with a summary', async () => {
		mockClassifyArchivePageTemplates.mockImplementation(
			(_archive: Archive, options: { onProgress?: (event: unknown) => void }) => {
				options.onProgress?.({ phase: 'loading-pages', done: 3, total: 10 });
				return Promise.resolve({
					classifiedPageCount: 10,
					templateCount: 2,
					sampledBlocks: [],
				});
			},
		);
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');
		const onProgress = vi.fn();

		const result = await classifyTemplatesQuietly(fakeArchive, { onProgress });

		expect(result).toBeNull();
		expect(onProgress).toHaveBeenNthCalledWith(1, 'loading 3/10 pages (30%)');
		expect(onProgress).toHaveBeenLastCalledWith('10 page(s) in 2 template(s)');
	});

	it('reports an empty archive as nothing to classify', async () => {
		mockClassifyArchivePageTemplates.mockResolvedValue({
			classifiedPageCount: 0,
			templateCount: 0,
			sampledBlocks: [],
		});
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');
		const onProgress = vi.fn();

		await classifyTemplatesQuietly(fakeArchive, { onProgress });

		expect(onProgress).toHaveBeenLastCalledWith('No pages to classify');
	});

	it('never throws: returns the failure reason and reports it through onProgress', async () => {
		mockClassifyArchivePageTemplates.mockRejectedValue(new Error('clustering blew up'));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');
		const onProgress = vi.fn();

		const result = await classifyTemplatesQuietly(fakeArchive, { onProgress });

		expect(result).toBe('clustering blew up');
		expect(onProgress).toHaveBeenLastCalledWith(
			'Classify page templates failed, continuing without it: clustering blew up',
		);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('under --silent (no onProgress), logs nothing on success but still reports a failure via console.error', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { classifyTemplatesQuietly } = await import('./classify-templates-quietly.js');

		mockClassifyArchivePageTemplates.mockResolvedValue({
			classifiedPageCount: 4,
			templateCount: 1,
			sampledBlocks: [],
		});
		expect(await classifyTemplatesQuietly(fakeArchive)).toBeNull();
		expect(errorSpy).not.toHaveBeenCalled();

		mockClassifyArchivePageTemplates.mockRejectedValue('plain string failure');
		const result = await classifyTemplatesQuietly(fakeArchive);
		expect(result).toBe('plain string failure');
		expect(errorSpy).toHaveBeenLastCalledWith(
			'[nitpicker] Classify page templates failed, continuing without it: plain string failure',
		);
	});
});
