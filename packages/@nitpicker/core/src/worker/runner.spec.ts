import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { UrlEventBus } from '../url-event-bus.js';

import { runner } from './runner.js';

describe('runner', () => {
	let mockModule: { default: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		mockModule = {
			default: vi.fn().mockResolvedValue({ result: 'test-result' }),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('calls the dynamically imported module default export with correct arguments', async () => {
		const emitter = new UrlEventBus();
		const filePath = new URL('fixtures/mock-runner-module.js', import.meta.url).pathname;

		// Use vi.doMock to intercept the dynamic import
		vi.doMock(filePath, () => mockModule);

		await runner(
			{
				filePath,
				num: 3,
				total: 10,
				customData: 'hello',
			},
			emitter,
		);

		expect(mockModule.default).toHaveBeenCalledOnce();
		const [data, receivedEmitter, num, total] = mockModule.default.mock.calls[0];
		expect(receivedEmitter).toBe(emitter);
		expect(num).toBe(3);
		expect(total).toBe(10);
		expect(data.customData).toBe('hello');
	});

	it('deletes filePath from data before passing to module', async () => {
		const emitter = new UrlEventBus();
		const filePath = new URL('fixtures/mock-runner-module.js', import.meta.url).pathname;

		vi.doMock(filePath, () => mockModule);

		await runner(
			{
				filePath,
				num: 1,
				total: 1,
				key: 'value',
			},
			emitter,
		);

		const [data] = mockModule.default.mock.calls[0];
		expect(data).not.toHaveProperty('filePath');
	});

	it('returns the result from the module function', async () => {
		const emitter = new UrlEventBus();
		const filePath = new URL('fixtures/mock-runner-module.js', import.meta.url).pathname;

		mockModule.default.mockResolvedValue({ score: 100 });
		vi.doMock(filePath, () => mockModule);

		const result = await runner({ filePath, num: 0, total: 1 }, emitter);

		expect(result).toEqual({ score: 100 });
	});

	it('propagates errors from the module function', async () => {
		const emitter = new UrlEventBus();
		const filePath = new URL('fixtures/mock-runner-module.js', import.meta.url).pathname;

		mockModule.default.mockRejectedValue(new Error('Plugin failed'));
		vi.doMock(filePath, () => mockModule);

		await expect(runner({ filePath, num: 0, total: 1 }, emitter)).rejects.toThrow(
			'Plugin failed',
		);
	});

	it('passes num and total correctly', async () => {
		const emitter = new UrlEventBus();
		const filePath = new URL('fixtures/mock-runner-module.js', import.meta.url).pathname;

		vi.doMock(filePath, () => mockModule);

		await runner({ filePath, num: 7, total: 42 }, emitter);

		const args = mockModule.default.mock.calls[0];
		expect(args[2]).toBe(7);
		expect(args[3]).toBe(42);
	});
});
