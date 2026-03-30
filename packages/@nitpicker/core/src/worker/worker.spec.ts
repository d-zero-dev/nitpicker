import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level mocks must be set up before importing the module under test.
// worker.ts executes code at module scope, so each test uses vi.resetModules()
// and dynamic import() to get a fresh execution.

const mockPostMessage = vi.fn();
let mockWorkerData: Record<string, unknown> = {};
let mockParentPort: { postMessage: typeof mockPostMessage } | null = {
	postMessage: mockPostMessage,
};

vi.mock('node:worker_threads', () => ({
	get parentPort() {
		return mockParentPort;
	},
	get workerData() {
		return mockWorkerData;
	},
}));

const mockRunnerResult = vi.fn();

vi.mock('./runner.js', () => ({
	runner: mockRunnerResult,
}));

const { MockUrlEventBus } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
	const { EventEmitter } = require('node:events');
	/** Mock UrlEventBus for worker tests. */
	class MockUrlEventBus extends EventEmitter {}
	return { MockUrlEventBus };
});

vi.mock('../url-event-bus.js', () => ({
	UrlEventBus: MockUrlEventBus,
}));

describe('worker', () => {
	beforeEach(() => {
		vi.resetModules();
		mockPostMessage.mockClear();
		mockRunnerResult.mockReset();
		mockParentPort = { postMessage: mockPostMessage };
		mockWorkerData = { filePath: '/test/module.js', num: 1, total: 5, key: 'value' };
	});

	it('posts finish message with result on successful runner execution', async () => {
		mockRunnerResult.mockResolvedValue({ score: 100 });

		await import('./worker.js');

		// Wait for async execution to complete
		await vi.waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: 'finish',
				result: { score: 100 },
			});
		});
	});

	it('posts finish message with error on runner failure', async () => {
		mockRunnerResult.mockRejectedValue(new Error('Plugin crashed'));

		await import('./worker.js');

		await vi.waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: 'finish',
				result: null,
				error: 'Plugin crashed',
			});
		});
	});

	it('posts finish message with stringified error for non-Error throws', async () => {
		mockRunnerResult.mockRejectedValue('string error');

		await import('./worker.js');

		await vi.waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: 'finish',
				result: null,
				error: 'string error',
			});
		});
	});

	it('forwards url events from emitter to parentPort', async () => {
		mockRunnerResult.mockImplementation(
			(_data: unknown, emitter: { emit: (event: string, url: string) => void }) => {
				emitter.emit('url', 'https://discovered.example.com/');
				return Promise.resolve(null);
			},
		);

		await import('./worker.js');

		await vi.waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: 'url',
				url: 'https://discovered.example.com/',
			});
		});
	});

	it('passes workerData to runner', async () => {
		mockWorkerData = { filePath: '/path/to/mod.js', num: 3, total: 8, extra: 'data' };
		mockRunnerResult.mockResolvedValue(null);

		await import('./worker.js');

		await vi.waitFor(() => {
			expect(mockRunnerResult).toHaveBeenCalledOnce();
		});

		const [data] = mockRunnerResult.mock.calls[0];
		expect(data).toEqual({
			filePath: '/path/to/mod.js',
			num: 3,
			total: 8,
			extra: 'data',
		});
	});

	it('throws when parentPort is null during url emit', async () => {
		mockParentPort = null;
		mockRunnerResult.mockImplementation(
			(_data: unknown, emitter: { emit: (event: string, url: string) => void }) => {
				emitter.emit('url', 'https://example.com/');
				return Promise.resolve(null);
			},
		);

		await expect(import('./worker.js')).rejects.toThrow('Use in worker thread');
	});

	it('throws when parentPort is null after successful runner execution', async () => {
		mockRunnerResult.mockResolvedValue({ result: 'ok' });
		mockParentPort = null;

		// runner succeeds → try block hits `if (!parentPort) throw`
		// → catch block also hits `if (!parentPort) throw`
		// → unhandled rejection from module top-level await
		await expect(import('./worker.js')).rejects.toThrow('Use in worker thread');
	});
});
