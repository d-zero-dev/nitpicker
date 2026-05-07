import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level mocks must be set up before importing the module under test.
// worker.ts subscribes to parentPort.on('message') at module scope, so each
// test uses vi.resetModules() and dynamic import() to get a fresh execution.

const mockPostMessage = vi.fn();
let messageHandler: ((message: unknown) => void) | null = null;

/** Records a 'message' handler so tests can drive the worker by simulating messages. */
const mockOn = vi.fn((event: string, handler: (message: unknown) => void) => {
	if (event === 'message') {
		messageHandler = handler;
	}
});

let mockParentPort: { postMessage: typeof mockPostMessage; on: typeof mockOn } | null = {
	postMessage: mockPostMessage,
	on: mockOn,
};

vi.mock('node:worker_threads', () => ({
	get parentPort() {
		return mockParentPort;
	},
}));

const mockRunner = vi.fn();

vi.mock('./runner.js', () => ({
	runner: mockRunner,
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
		mockOn.mockClear();
		mockRunner.mockReset();
		messageHandler = null;
		mockParentPort = { postMessage: mockPostMessage, on: mockOn };
	});

	it('processes a task message and posts a result', async () => {
		mockRunner.mockResolvedValue({ score: 100 });

		await import('./worker.js');

		expect(messageHandler).not.toBeNull();
		messageHandler!({
			type: 'task',
			taskId: 7,
			data: { filePath: '/m.js', num: 0, total: 1 },
		});

		await vi.waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: 'result',
				taskId: 7,
				result: { score: 100 },
			});
		});
	});

	it('reports runner failure as an error result without crashing the worker', async () => {
		mockRunner.mockRejectedValue(new Error('Plugin crashed'));

		await import('./worker.js');

		messageHandler!({
			type: 'task',
			taskId: 1,
			data: { filePath: '/m.js', num: 0, total: 1 },
		});

		await vi.waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: 'result',
				taskId: 1,
				result: null,
				error: 'Plugin crashed',
			});
		});
	});

	it('stringifies non-Error throws', async () => {
		mockRunner.mockRejectedValue('string error');

		await import('./worker.js');

		messageHandler!({ type: 'task', taskId: 2, data: {} });

		await vi.waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: 'result',
				taskId: 2,
				result: null,
				error: 'string error',
			});
		});
	});

	it('forwards url events tagged with the active taskId', async () => {
		mockRunner.mockImplementation(
			(_data: unknown, emitter: { emit: (event: string, url: string) => void }) => {
				emitter.emit('url', 'https://discovered.example.com/');
				return Promise.resolve(null);
			},
		);

		await import('./worker.js');

		messageHandler!({ type: 'task', taskId: 42, data: {} });

		await vi.waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: 'url',
				taskId: 42,
				url: 'https://discovered.example.com/',
			});
		});
	});

	it('passes task data through to runner', async () => {
		mockRunner.mockResolvedValue(null);

		await import('./worker.js');

		messageHandler!({
			type: 'task',
			taskId: 5,
			data: { filePath: '/path/to/mod.js', num: 3, total: 8, extra: 'data' },
		});

		await vi.waitFor(() => {
			expect(mockRunner).toHaveBeenCalledOnce();
		});

		const [data] = mockRunner.mock.calls[0];
		expect(data).toEqual({
			filePath: '/path/to/mod.js',
			num: 3,
			total: 8,
			extra: 'data',
		});
	});

	it('exits the process on shutdown message after a microtask flush', async () => {
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
			// no-op: test asserts via the spy rather than throwing here
		}) as never);

		await import('./worker.js');

		messageHandler!({ type: 'shutdown' });
		// process.exit is deferred via setImmediate so any in-flight postMessage
		// from the previous task can flush before the worker exits.
		expect(exitSpy).not.toHaveBeenCalled();
		await new Promise((resolve) => setImmediate(resolve));
		expect(exitSpy).toHaveBeenCalledWith(0);

		exitSpy.mockRestore();
	});

	it('ignores malformed messages without crashing', async () => {
		mockRunner.mockResolvedValue(null);

		await import('./worker.js');

		messageHandler!(null);
		messageHandler!('not an object');
		messageHandler!({ type: 'unknown' });

		expect(mockRunner).not.toHaveBeenCalled();
		expect(mockPostMessage).not.toHaveBeenCalled();
	});

	it('throws at module load when parentPort is null', async () => {
		mockParentPort = null;
		await expect(import('./worker.js')).rejects.toThrow('Use in worker thread');
	});
});
