import type { CrawlerOrchestrator } from '@nitpicker/crawler';

import { Lanes } from '@d-zero/dealer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

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

const mockLanesUpdate = vi.fn();
const mockLanesClose = vi.fn();

vi.mock('@d-zero/dealer', () => ({
	Lanes: vi.fn().mockImplementation(function (this: {
		update: typeof mockLanesUpdate;
		close: typeof mockLanesClose;
	}) {
		this.update = mockLanesUpdate;
		this.close = mockLanesClose;
	}),
}));

describe('attachCrawlDisplay', () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('logType が silent の場合、購読も出力も行わない', () => {
		const orchestrator = createMockOrchestrator();
		const errStack: Error[] = [];

		const { close } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'silent',
			errStack,
		});

		expect(orchestrator.on).not.toHaveBeenCalled();
		expect(stderrSpy).not.toHaveBeenCalled();
		expect(() => close()).not.toThrow();
	});

	it('初期ログを stderr に出力する', () => {
		const orchestrator = createMockOrchestrator();
		attachCrawlDisplay({
			orchestrator,
			initialLog: ['🐳 header', '  key: value'],
			logType: 'normal',
			errStack: [],
		});

		expect(stderrSpy).toHaveBeenCalledTimes(1);
		const output = stderrSpy.mock.calls[0]![0] as string;
		expect(output).toContain('header');
		expect(output).toContain('key: value');
	});

	it('error イベントを errStack に積む', () => {
		const orchestrator = createMockOrchestrator();
		const errStack: Error[] = [];
		attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'normal',
			errStack,
		});

		const error = new Error('crawl error');
		orchestrator.emit('error', error);

		expect(errStack).toEqual([error]);
	});

	it('flushingPendingWrites イベントで残件数付きの行を表示する（issue #294）', () => {
		const orchestrator = createMockOrchestrator();
		attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'normal',
			errStack: [],
		});

		orchestrator.emit('flushingPendingWrites', { pending: 3 });

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Flushing 3 pending write(s)%dots%',
		);
	});

	it('sortingUrls イベントで件数進捗を表示する（issue #294）', () => {
		const orchestrator = createMockOrchestrator();
		attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'normal',
			errStack: [],
		});

		orchestrator.emit('sortingUrls', { processed: 500, total: 1200 });
		orchestrator.emit('sortingUrls', { processed: 1200, total: 1200 });

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Sorting pages: 500/1,200 pages (41%)',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Sorting pages: 1,200/1,200 pages (100%)',
		);
	});

	it('logType が verbose のとき、Lanes に verbose: true を渡す（issue #294）', () => {
		const orchestrator = createMockOrchestrator();
		attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'verbose',
			errStack: [],
		});

		orchestrator.emit('flushingPendingWrites', { pending: 1 });

		expect(Lanes).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
		const isoTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringMatching(new RegExp(`^${isoTimestamp.source} .*Flushing 1`)),
		);
	});

	it('close() は Lanes インスタンスを解放する', () => {
		const orchestrator = createMockOrchestrator();
		const { close } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'normal',
			errStack: [],
		});

		close();

		expect(mockLanesClose).toHaveBeenCalledOnce();
	});

	it('recoveringArchiveWrite イベントを console.error にフォールバック表示する（issue #294）', () => {
		const orchestrator = createMockOrchestrator();
		const { close } = attachCrawlDisplay({
			orchestrator,
			initialLog: ['header'],
			logType: 'normal',
			errStack: [],
		});
		close();

		orchestrator.emit('recoveringArchiveWrite', {});

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Recovering: retrying archive write'),
		);
	});
});
