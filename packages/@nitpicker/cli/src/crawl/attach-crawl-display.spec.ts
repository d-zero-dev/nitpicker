import type { CrawlerOrchestrator } from '@nitpicker/crawler';

import { afterEach, describe, it, expect, vi } from 'vitest';

import { attachCrawlDisplay } from './attach-crawl-display.js';

type EventHandler = (...args: unknown[]) => void;

/** Mock orchestrator with controllable event emission. */
interface MockOrchestrator extends CrawlerOrchestrator {
	/**
	 * Emits a registered event synchronously.
	 * @param event - Event name
	 * @param args - Event arguments
	 */
	emit(event: string, ...args: unknown[]): void;
}

/** Creates a mock CrawlerOrchestrator with controllable event emission. */
function createMockOrchestrator(): MockOrchestrator {
	const handlers: Record<string, EventHandler[]> = {};
	return {
		on: vi.fn((event: string, handler: EventHandler) => {
			handlers[event] ??= [];
			handlers[event].push(handler);
		}),
		emit(event: string, ...args: unknown[]): void {
			for (const handler of handlers[event] ?? []) {
				handler(...args);
			}
		},
	} as unknown as MockOrchestrator;
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

/**
 * Yields one microtask tick — the gap dealer's `TaskListPipeline` needs to
 * advance to the next row once the currently-active one resolves (mirrors
 * `create-setup-task-list.spec.ts`'s `tick()` helper).
 */
function tick() {
	return Promise.resolve();
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('attachCrawlDisplay', () => {
	it('logType が silent の場合、購読も出力も行わない', async () => {
		const orchestrator = createMockOrchestrator();
		const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		const errStack: Error[] = [];

		const { finish, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'silent',
			errStack,
		});

		expect(orchestrator.on).not.toHaveBeenCalled();
		expect(stderrSpy).not.toHaveBeenCalled();
		expect(() => finish()).not.toThrow();
		await expect(taskListDone).resolves.toBeUndefined();
	});

	it('初期ログを stderr に出力する', async () => {
		const orchestrator = createMockOrchestrator();
		const { stream } = createCapturingStream();
		const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			stream.write(chunk as string);
			return true;
		});
		const { finish, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['🐳 header', '  key: value'],
			logType: 'normal',
			errStack: [],
		});

		// The header write is the first stderr write — later writes are the
		// TaskList's own row rendering (issue #294), not part of this test.
		const output = stderrSpy.mock.calls[0]![0] as string;
		expect(output).toContain('header');
		expect(output).toContain('key: value');

		finish();
		await taskListDone;

		finish();
		await taskListDone;
	});

	it('error イベントを errStack に積む', async () => {
		const orchestrator = createMockOrchestrator();
		vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		const errStack: Error[] = [];
		const { finish, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'normal',
			errStack,
		});

		const error = new Error('crawl error');
		orchestrator.emit('error', error);

		expect(errStack).toEqual([error]);

		finish();
		await taskListDone;
	});

	it('renders Flushing pending writes then Sorting pages as individual rows, in order (issue #294)', async () => {
		const orchestrator = createMockOrchestrator();
		const { stream, lines } = createCapturingStream();
		vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			stream.write(chunk as string);
			return true;
		});
		const { finish, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'verbose',
			errStack: [],
		});

		orchestrator.emit('flushingPendingWrites', { pending: 3 });
		await tick();
		orchestrator.emit('sortingUrls', { processed: 500, total: 1200 });
		await tick();
		orchestrator.emit('sortingUrls', { processed: 1200, total: 1200 });
		finish();

		await expect(taskListDone).resolves.toBeUndefined();
		const rendered = lines.join('');
		expect(rendered).toContain('Flushing pending writes: 3 pending write(s)');
		expect(rendered).toContain('Sorting pages: 1,200/1,200 pages (100%)');
	});

	it('marks Flushing pending writes as skipped when nothing was pending, then still renders Sorting pages', async () => {
		const orchestrator = createMockOrchestrator();
		const { stream, lines } = createCapturingStream();
		vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			stream.write(chunk as string);
			return true;
		});
		const { finish, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'verbose',
			errStack: [],
		});

		orchestrator.emit('sortingUrls', { processed: 1, total: 1 });
		await tick();
		orchestrator.emit('sortingUrls', { processed: 2, total: 2 });
		finish();

		await expect(taskListDone).resolves.toBeUndefined();
		const rendered = lines.join('');
		expect(rendered).toContain('Flushing pending writes');
		expect(rendered).toContain('skipped');
		expect(rendered).toContain('Sorting pages: 2/2 pages (100%)');
	});

	it('renders a crawlSessionNotice on the active row, starting the pipeline if neither other event fired yet (issue #294 code review)', async () => {
		const orchestrator = createMockOrchestrator();
		const { stream, lines } = createCapturingStream();
		vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			stream.write(chunk as string);
			return true;
		});
		const { finish, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'verbose',
			errStack: [],
		});

		orchestrator.emit('crawlSessionNotice', {
			message: '[preload] Short-circuited 2 URL(s) on DNS-burned hosts',
		});
		finish();

		await expect(taskListDone).resolves.toBeUndefined();
		const rendered = lines.join('');
		expect(rendered).toContain(
			'Flushing pending writes: [preload] Short-circuited 2 URL(s) on DNS-burned hosts',
		);
	});

	it('finish() settles both rows as skipped when neither event ever fires (nothing to flush or sort)', async () => {
		const orchestrator = createMockOrchestrator();
		const { stream, lines } = createCapturingStream();
		vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			stream.write(chunk as string);
			return true;
		});
		const { finish, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'verbose',
			errStack: [],
		});

		finish();

		await expect(taskListDone).resolves.toBeUndefined();
		const rendered = lines.join('');
		expect(rendered).toContain('Flushing pending writes');
		expect(rendered).toContain('Sorting pages');
	});

	it('fail() rejects the active row with the given error', async () => {
		const orchestrator = createMockOrchestrator();
		vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		const { fail, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'normal',
			errStack: [],
		});

		const boom = new Error('crawling failed');
		fail(boom);

		await expect(taskListDone).rejects.toMatchObject({ cause: boom });
	});

	it('logType が verbose のとき、行ごとに ISO 8601 タイムスタンプを前置する（issue #294）', async () => {
		const orchestrator = createMockOrchestrator();
		const { stream, lines } = createCapturingStream();
		vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			stream.write(chunk as string);
			return true;
		});
		const { finish, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'verbose',
			errStack: [],
		});

		orchestrator.emit('flushingPendingWrites', { pending: 1 });
		finish();

		await expect(taskListDone).resolves.toBeUndefined();
		const isoTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
		const rendered = lines.join('');
		expect(isoTimestamp.test(rendered)).toBe(true);
	});

	it('recoveringArchiveWrite イベントを console.error にフォールバック表示する（issue #294）', async () => {
		const orchestrator = createMockOrchestrator();
		vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { finish, taskListDone } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'normal',
			errStack: [],
		});
		finish();
		await taskListDone;

		orchestrator.emit('recoveringArchiveWrite', {});

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Recovering: retrying archive write'),
		);
	});
});
