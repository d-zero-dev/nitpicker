import type { CrawlEvent } from '@nitpicker/crawler';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { VIEWER_READ_MODEL_FULL_BUILD_PHASES } from '../viewer-read-model-full-build-phases.js';

const mockScanJsResourcesQuietly = vi.fn();
const mockEnsureViewerReadModelQuietly = vi.fn();
const mockBuildViewerReadModelInWorker = vi.fn();

vi.mock('./scan-js-resources-quietly.js', () => ({
	scanJsResourcesQuietly: mockScanJsResourcesQuietly,
}));
vi.mock('./ensure-viewer-read-model-quietly.js', () => ({
	ensureViewerReadModelQuietly: mockEnsureViewerReadModelQuietly,
}));
vi.mock('@nitpicker/query', () => ({
	buildViewerReadModelInWorker: mockBuildViewerReadModelInWorker,
}));

/**
 * Calls `onPhase` for each phase in order, yielding a microtask tick after
 * each call — the same gap the real `buildViewerReadModel` always has before
 * the next `onPhase` (each is followed by a genuinely awaited operation),
 * needed here so dealer's `TaskListPipeline` has a chance to advance to the
 * next row before the next call arrives (mirrors
 * `create-setup-task-list.spec.ts`'s `tick()` helper).
 * @param options
 * @param options.onPhase
 * @param phases
 */
async function driveOnPhase(
	options: { onPhase: (phase: string) => void },
	phases: readonly string[],
): Promise<void> {
	for (const phase of phases) {
		options.onPhase(phase);
		await Promise.resolve();
	}
}

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
		listeners.get('writeFileStart')?.({
			filePath: '/tmp/fake.nitpicker',
		} satisfies CrawlEvent['writeFileStart']);
		listeners.get('writeStep')?.({
			step: 'checkpoint',
		} satisfies CrawlEvent['writeStep']);
		listeners.get('writeTarProgress')?.({
			writtenBytes: 50_000_000,
			totalBytes: 100_000_000,
		} satisfies CrawlEvent['writeTarProgress']);
		listeners.get('writeFileEnd')?.({
			filePath: '/tmp/fake.nitpicker',
		} satisfies CrawlEvent['writeFileEnd']);
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
	it('runs Scan JS resources, every read-model phase, and Write archive in order (issue #294)', async () => {
		mockScanJsResourcesQuietly.mockResolvedValue();
		mockBuildViewerReadModelInWorker.mockImplementation(async (_archive, options) => {
			await driveOnPhase(options, VIEWER_READ_MODEL_FULL_BUILD_PHASES);
		});
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
		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledOnce();
		expect(mockEnsureViewerReadModelQuietly).not.toHaveBeenCalled();
		expect(orchestrator.write).toHaveBeenCalledOnce();
		const rendered = lines.join('');
		expect(rendered).toContain('Scan JS resources');
		expect(rendered).not.toContain('Build viewer read model');
		expect(rendered).toContain('Backfilling analysis violations');
		expect(rendered).toContain('Building anchor facts');
		expect(rendered).toContain('Checkpointing read model');
		expect(rendered).toContain('Write archive');
		expect(rendered).toContain('Checkpointing database');
		expect(rendered).toContain('50/100 MB');
	});

	it('reports a read-model failure on its row and still writes the archive (issue #294)', async () => {
		mockScanJsResourcesQuietly.mockResolvedValue();
		mockBuildViewerReadModelInWorker.mockRejectedValue(new Error('disk full'));
		const { runPostCrawlTaskList } = await import('./run-post-crawl-task-list.js');
		const orchestrator = createFakeOrchestrator();
		const { stream, lines } = createCapturingStream();

		await runPostCrawlTaskList(orchestrator as never, {
			verbose: true,
			silent: false,
			skipTechnologyJsScan: false,
			stream,
		});

		expect(orchestrator.write).toHaveBeenCalledOnce();
		const rendered = lines.join('');
		expect(rendered).toContain(
			'Viewer read model build failed, writing the archive without it',
		);
		expect(rendered).toContain('Write archive');
	});

	it('shows the archive file path on write start and completion (issue #294 code review: restores the path event-assignments.ts used to show)', async () => {
		mockScanJsResourcesQuietly.mockResolvedValue();
		mockBuildViewerReadModelInWorker.mockImplementation(async (_archive, options) => {
			await driveOnPhase(options, VIEWER_READ_MODEL_FULL_BUILD_PHASES);
		});
		const { runPostCrawlTaskList } = await import('./run-post-crawl-task-list.js');
		const orchestrator = createFakeOrchestrator();
		const { stream, lines } = createCapturingStream();

		await runPostCrawlTaskList(orchestrator as never, {
			verbose: true,
			silent: false,
			skipTechnologyJsScan: false,
			stream,
		});

		const rendered = lines.join('');
		expect(rendered).toContain('Writing to: /tmp/fake.nitpicker');
		expect(rendered).toContain('Done: /tmp/fake.nitpicker');
	});

	it('skips the Scan JS resources row when skipTechnologyJsScan is true', async () => {
		mockScanJsResourcesQuietly.mockResolvedValue();
		mockBuildViewerReadModelInWorker.mockImplementation(async (_archive, options) => {
			await driveOnPhase(options, VIEWER_READ_MODEL_FULL_BUILD_PHASES);
		});
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
		expect(mockBuildViewerReadModelInWorker).not.toHaveBeenCalled();
		expect(orchestrator.write).toHaveBeenCalledOnce();
	});

	it('propagates a Write archive failure without swallowing it', async () => {
		mockScanJsResourcesQuietly.mockResolvedValue();
		mockBuildViewerReadModelInWorker.mockImplementation(async (_archive, options) => {
			await driveOnPhase(options, VIEWER_READ_MODEL_FULL_BUILD_PHASES);
		});
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
