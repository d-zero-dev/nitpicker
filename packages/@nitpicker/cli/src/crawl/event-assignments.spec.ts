import type { CrawlerOrchestrator } from '@nitpicker/crawler';

import { Lanes } from '@d-zero/dealer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { eventAssignments } from './event-assignments.js';

type EventHandler = (...args: unknown[]) => void;

/**
 * Mock orchestrator with controllable event emission.
 */
interface MockOrchestrator extends CrawlerOrchestrator {
	/**
	 * Emits a registered event synchronously.
	 * @param event - Event name
	 * @param args - Event arguments
	 */
	emit(event: string, ...args: unknown[]): void;
}

/**
 * Creates a mock CrawlerOrchestrator with controllable event emission.
 */
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

vi.mock('@d-zero/dealer', () => ({
	Lanes: vi.fn().mockImplementation(function (this: {
		update: typeof mockLanesUpdate;
		[Symbol.dispose]: ReturnType<typeof vi.fn>;
	}) {
		this.update = mockLanesUpdate;
		this[Symbol.dispose] = vi.fn();
	}),
}));

describe('eventAssignments', () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('logType が silent の場合、即座に resolve する', async () => {
		const orchestrator = createMockOrchestrator();
		await eventAssignments(orchestrator, ['header'], 'silent');

		expect(orchestrator.on).not.toHaveBeenCalled();
		expect(stderrSpy).not.toHaveBeenCalled();
	});

	it('初期ログを stderr に出力する', () => {
		const orchestrator = createMockOrchestrator();
		void eventAssignments(orchestrator, ['🐳 header', '  key: value'], 'normal');

		expect(stderrSpy).toHaveBeenCalledTimes(1);
		const output = stderrSpy.mock.calls[0]![0] as string;
		expect(output).toContain('header');
		expect(output).toContain('key: value');
	});

	it('error イベントで reject する', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		const error = new Error('crawl error');
		orchestrator.emit('error', error);

		await expect(promise).rejects.toBe(error);
	});

	it('writeFileStart イベントでファイルパスを Lanes 行に表示する（issue #294: アニメーション付き）', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		orchestrator.emit('writeFileStart', { filePath: '/tmp/out.nitpicker' });
		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });
		await promise;

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Writing to: /tmp/out.nitpicker%dots%',
		);
	});

	it('writeFileEnd イベントで resolve する', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });

		await expect(promise).resolves.toBeUndefined();
	});

	it('flushingPendingWrites イベントで残件数付きの行を表示する（issue #294）', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		orchestrator.emit('flushingPendingWrites', { pending: 3 });
		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });
		await promise;

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Flushing 3 pending write(s)%dots%',
		);
	});

	it('recoveringArchiveWrite イベントでリカバリー中を示すラベルを表示する（issue #294）', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		orchestrator.emit('recoveringArchiveWrite', {});
		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });
		await promise;

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Recovering: retrying archive write%dots%',
		);
	});

	it('writeStep イベントでラベル付き・アニメーション付きの行を表示する（issue #294）', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		orchestrator.emit('writeStep', { step: 'checkpoint' });
		orchestrator.emit('writeStep', { step: 'rename' });
		orchestrator.emit('writeStep', { step: 'tar' });
		orchestrator.emit('writeStep', { step: 'remove' });
		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });
		await promise;

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Checkpointing database%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Finalizing archive layout%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Writing archive%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Removing temporary files%dots%',
		);
	});

	it('writeTarProgress イベントでバイト進捗を MB 表示する（issue #294）', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		orchestrator.emit('writeTarProgress', {
			writtenBytes: 50_000_000,
			totalBytes: 200_000_000,
		});
		orchestrator.emit('writeTarProgress', {
			writtenBytes: 200_000_000,
			totalBytes: 200_000_000,
		});
		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });
		await promise;

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Writing archive: 50/200 MB (25%)',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Writing archive: 200/200 MB (100%)',
		);
	});

	it('sortingUrls イベントで件数進捗を表示する（issue #294）', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		orchestrator.emit('sortingUrls', { processed: 500, total: 1200 });
		orchestrator.emit('sortingUrls', { processed: 1200, total: 1200 });
		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });
		await promise;

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Sorting pages: 500/1,200 pages (41%)',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Sorting pages: 1,200/1,200 pages (100%)',
		);
	});

	it('logType が verbose のとき、Lanes に verbose: true を渡し ISO 8601 タイムスタンプを付与する（issue #294）', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'verbose');

		orchestrator.emit('writeStep', { step: 'checkpoint' });
		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });
		await promise;

		expect(Lanes).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
		const isoTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringMatching(
				new RegExp(`^${isoTimestamp.source} .*Checkpointing database`),
			),
		);
	});
});
