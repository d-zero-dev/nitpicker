import type { CrawlEvent } from '@nitpicker/crawler';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mockScanJsResourcesQuietly = vi.fn();
const mockEnsureViewerReadModelQuietly = vi.fn();

vi.mock('./scan-js-resources-quietly.js', () => ({
	scanJsResourcesQuietly: mockScanJsResourcesQuietly,
}));
vi.mock('./ensure-viewer-read-model-quietly.js', () => ({
	ensureViewerReadModelQuietly: mockEnsureViewerReadModelQuietly,
}));

/** A minimal writable that records every chunk written to it, verbatim. */
function createCapturingStream() {
	const lines: string[] = [];
	const stream: NodeJS.WritableStream = {
		write: (chunk: string) => {
			lines.push(chunk);
			return true;
		},
		on: () => stream,
		off: () => stream,
	} as unknown as NodeJS.WritableStream;
	return { stream, lines };
}

/** A fake `CrawlerOrchestrator` exposing just what `runPostCrawlTaskList` touches. */
function createFakeOrchestrator() {
	const listeners = new Map<string, (arg: unknown) => void>();
	const write = vi.fn(() => {
		listeners.get('writeStep')?.({
			step: 'checkpoint',
		} satisfies CrawlEvent['writeStep']);
		listeners.get('writeTarProgress')?.({
			writtenBytes: 50_000_000,
			totalBytes: 100_000_000,
		} satisfies CrawlEvent['writeTarProgress']);
		return Promise.resolve();
	});
	const orchestrator = {
		archive: { filePath: '/tmp/fake.nitpicker' },
		on: vi.fn((event: string, listener: (arg: unknown) => void) => {
			listeners.set(event, listener);
			return orchestrator;
		}),
		write,
	};
	return orchestrator;
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('runPostCrawlTaskList', () => {
	it('runs Scan JS resources, Build viewer read model, and Write archive in order', async () => {
		mockScanJsResourcesQuietly.mockResolvedValue();
		mockEnsureViewerReadModelQuietly.mockResolvedValue();
		const { runPostCrawlTaskList } = await import('./run-post-crawl-task-list.js');
		const orchestrator = createFakeOrchestrator();
		const { stream, lines } = createCapturingStream();

		await runPostCrawlTaskList(orchestrator as never, {
			verbose: true,
			silent: false,
			skipTechnologyJsScan: false,
			stream,
		});

		expect(mockScanJsResourcesQuietly).toHaveBeenCalledWith(
			orchestrator.archive,
			expect.any(Function),
		);
		expect(mockEnsureViewerReadModelQuietly).toHaveBeenCalledWith(
			orchestrator.archive,
			expect.any(Function),
		);
		expect(orchestrator.write).toHaveBeenCalledOnce();
		const rendered = lines.join('');
		expect(rendered).toContain('Scan JS resources');
		expect(rendered).toContain('Build viewer read model');
		expect(rendered).toContain('Write archive');
		expect(rendered).toContain('Checkpointing database');
		expect(rendered).toContain('50/100 MB');
	});

	it('skips the Scan JS resources row when skipTechnologyJsScan is true', async () => {
		mockScanJsResourcesQuietly.mockResolvedValue();
		mockEnsureViewerReadModelQuietly.mockResolvedValue();
		const { runPostCrawlTaskList } = await import('./run-post-crawl-task-list.js');
		const orchestrator = createFakeOrchestrator();
		const { stream, lines } = createCapturingStream();

		await runPostCrawlTaskList(orchestrator as never, {
			verbose: true,
			silent: false,
			skipTechnologyJsScan: true,
			stream,
		});

		expect(mockScanJsResourcesQuietly).not.toHaveBeenCalled();
		const rendered = lines.join('');
		expect(rendered).not.toContain('Scan JS resources');
	});

	it('under --silent, runs the same steps without any TaskList rendering', async () => {
		mockScanJsResourcesQuietly.mockResolvedValue();
		mockEnsureViewerReadModelQuietly.mockResolvedValue();
		const { runPostCrawlTaskList } = await import('./run-post-crawl-task-list.js');
		const orchestrator = createFakeOrchestrator();

		await runPostCrawlTaskList(orchestrator as never, {
			verbose: false,
			silent: true,
			skipTechnologyJsScan: false,
		});

		expect(mockScanJsResourcesQuietly).toHaveBeenCalledWith(orchestrator.archive);
		expect(mockEnsureViewerReadModelQuietly).toHaveBeenCalledWith(orchestrator.archive);
		expect(orchestrator.write).toHaveBeenCalledOnce();
	});

	it('propagates a Write archive failure without swallowing it', async () => {
		mockScanJsResourcesQuietly.mockResolvedValue();
		mockEnsureViewerReadModelQuietly.mockResolvedValue();
		const { runPostCrawlTaskList } = await import('./run-post-crawl-task-list.js');
		const orchestrator = createFakeOrchestrator();
		orchestrator.write.mockRejectedValue(new Error('disk full'));
		const { stream } = createCapturingStream();

		await expect(
			runPostCrawlTaskList(orchestrator as never, {
				verbose: true,
				silent: false,
				skipTechnologyJsScan: false,
				stream,
			}),
		).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'disk full' }) });
	});
});
