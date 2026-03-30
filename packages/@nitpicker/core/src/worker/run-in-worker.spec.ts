import type { UrlEventBus } from '../url-event-bus.js';

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/**
 * Mock Worker class that simulates the node:worker_threads Worker API.
 * Uses vi.hoisted so the class is available inside vi.mock factory.
 */
const { MockWorker } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
	const { EventEmitter } = require('node:events');

	/** Simulates Worker thread for testing. */
	class MockWorker extends EventEmitter {
		/** Spy for terminate(). */
		terminate = vi.fn().mockResolvedValue();
		/** Spy for unref(). */
		unref = vi.fn();
		/** Captured workerData from the constructor call. */
		workerData: unknown;

		constructor(_workerPath: string, options?: { workerData: unknown }) {
			super();
			this.workerData = options?.workerData;
			MockWorker.lastInstance = this;
		}

		/** The most recently created MockWorker instance. */
		static lastInstance: MockWorker | null = null;
	}

	return { MockWorker };
});

vi.mock('node:worker_threads', () => ({
	Worker: MockWorker,
}));

vi.mock('./runner.js', () => ({
	runner: vi.fn(),
}));

import { runInWorker } from './run-in-worker.js';

describe('runInWorker', () => {
	let mockEmitter: UrlEventBus;

	beforeEach(() => {
		MockWorker.lastInstance = null;
		mockEmitter = {
			emit: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
		} as unknown as UrlEventBus;
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('creates a Worker with correct workerData', () => {
		void runInWorker({
			filePath: '/path/to/module.js',
			num: 3,
			total: 10,
			emitter: mockEmitter,
			initialData: { key: 'value' } as never,
		});

		const worker = MockWorker.lastInstance!;
		expect(worker).not.toBeNull();
		expect(worker.workerData).toEqual({
			filePath: '/path/to/module.js',
			num: 3,
			total: 10,
			key: 'value',
		});
	});

	it('resolves with result when worker sends finish message', async () => {
		const promise = runInWorker({
			filePath: '/path/to/module.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		worker.emit('message', { type: 'finish', result: { score: 42 } });

		await expect(promise).resolves.toEqual({ score: 42 });
	});

	it('rejects with error when worker sends finish message with error', async () => {
		const promise = runInWorker({
			filePath: '/path/to/module.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		worker.emit('message', { type: 'finish', error: 'Something failed' });

		await expect(promise).rejects.toThrow('Something failed');
	});

	it('forwards url messages to emitter', async () => {
		const promise = runInWorker({
			filePath: '/path/to/module.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		worker.emit('message', { type: 'url', url: 'https://discovered.example.com/' });
		worker.emit('message', { type: 'finish', result: null });

		await promise;

		expect(mockEmitter.emit).toHaveBeenCalledWith(
			'url',
			'https://discovered.example.com/',
		);
	});

	it('ignores null messages without crashing', async () => {
		const promise = runInWorker({
			filePath: '/path/to/module.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		worker.emit('message', null);
		worker.emit('message', { type: 'finish', result: 'ok' });

		await expect(promise).resolves.toBe('ok');
	});

	it('terminates worker and cleans up after finish', async () => {
		const promise = runInWorker({
			filePath: '/path/to/module.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		worker.emit('message', { type: 'finish', result: null });

		await promise;

		expect(worker.terminate).toHaveBeenCalled();
		expect(worker.unref).toHaveBeenCalled();
	});

	it('removes process signal listeners after finish', async () => {
		const removeSpy = vi.spyOn(process, 'removeListener');

		const promise = runInWorker({
			filePath: '/path/to/module.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		worker.emit('message', { type: 'finish', result: null });

		await promise;

		const removedSignals = removeSpy.mock.calls.map((call) => call[0]);
		expect(removedSignals).toContain('SIGABRT');
		expect(removedSignals).toContain('SIGQUIT');
		expect(removedSignals).toContain('disconnect');
		expect(removedSignals).toContain('exit');
		expect(removedSignals).toContain('uncaughtException');
		expect(removedSignals).toContain('uncaughtExceptionMonitor');
		expect(removedSignals).toContain('unhandledRejection');

		removeSpy.mockRestore();
	});

	it('spreads initialData into workerData', () => {
		void runInWorker({
			filePath: '/mod.js',
			num: 1,
			total: 5,
			emitter: mockEmitter,
			initialData: { custom: 'data', nested: { a: 1 } } as never,
		});

		const worker = MockWorker.lastInstance!;
		expect(worker.workerData).toEqual({
			filePath: '/mod.js',
			num: 1,
			total: 5,
			custom: 'data',
			nested: { a: 1 },
		});
	});

	it('registers error and messageerror handlers on worker', () => {
		void runInWorker({
			filePath: '/mod.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		expect(worker.listeners('error')).toHaveLength(1);
		expect(worker.listeners('messageerror')).toHaveLength(1);
	});

	it('removes SIGLOST listener after finish', async () => {
		const removeSpy = vi.spyOn(process, 'removeListener');

		const promise = runInWorker({
			filePath: '/mod.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		worker.emit('message', { type: 'finish', result: null });
		await promise;

		const removedSignals = removeSpy.mock.calls.map((call) => call[0]);
		expect(removedSignals).toContain('SIGLOST');

		removeSpy.mockRestore();
	});

	it('terminates worker and rejects on worker error event', async () => {
		const promise = runInWorker({
			filePath: '/mod.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		worker.emit('error', 'SIGABRT');

		await expect(promise).rejects.toBe('SIG: SIGABRT');
		expect(worker.terminate).toHaveBeenCalled();
		expect(worker.unref).toHaveBeenCalled();
	});

	it('terminates worker and rejects on messageerror event', async () => {
		const promise = runInWorker({
			filePath: '/mod.js',
			num: 0,
			total: 1,
			emitter: mockEmitter,
			initialData: {} as never,
		});

		const worker = MockWorker.lastInstance!;
		worker.emit('messageerror', 'SIGQUIT');

		await expect(promise).rejects.toBe('SIG: SIGQUIT');
		expect(worker.terminate).toHaveBeenCalled();
	});

	// Note: The fallback path (useWorker = false) cannot be tested directly
	// because `useWorker` is a const set to `true`. The runner() fallback
	// is covered indirectly by runner.spec.ts.
});
