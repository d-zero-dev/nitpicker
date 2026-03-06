import type { CrawlerOrchestrator } from '@nitpicker/crawler';

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

describe('eventAssignments', () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
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

	it('writeFileStart イベントでファイルパスを stderr に出力する', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		orchestrator.emit('writeFileStart', { filePath: '/tmp/out.nitpicker' });
		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });
		await promise;

		const calls = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(calls.some((c) => c.includes('/tmp/out.nitpicker'))).toBe(true);
	});

	it('writeFileEnd イベントで resolve する', async () => {
		const orchestrator = createMockOrchestrator();
		const promise = eventAssignments(orchestrator, ['header'], 'normal');

		orchestrator.emit('writeFileEnd', { filePath: '/tmp/out.nitpicker' });

		await expect(promise).resolves.toBeUndefined();
	});
});
