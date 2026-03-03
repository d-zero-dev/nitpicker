import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { log } from './log.js';

describe('log', () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let mockNitpicker: {
		handlers: Map<string, ((...args: never[]) => void)[]>;
		on: ReturnType<typeof vi.fn>;
		emit: (event: string, data: unknown) => void;
	};

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		mockNitpicker = {
			handlers: new Map(),
			on: vi.fn((event: string, handler: (...args: never[]) => void) => {
				const handlers = mockNitpicker.handlers.get(event) ?? [];
				handlers.push(handler);
				mockNitpicker.handlers.set(event, handlers);
			}),
			emit(event: string, data: unknown) {
				const handlers = this.handlers.get(event) ?? [];
				for (const handler of handlers) {
					handler(data as never);
				}
			},
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('prints all start log lines', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, ['line1', 'line2', 'line3'], false);

		expect(consoleSpy).toHaveBeenCalledTimes(3);
		expect(consoleSpy).toHaveBeenNthCalledWith(1, 'line1');
		expect(consoleSpy).toHaveBeenNthCalledWith(2, 'line2');
		expect(consoleSpy).toHaveBeenNthCalledWith(3, 'line3');
	});

	it('registers writeFile event handler', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, [], false);

		expect(mockNitpicker.on).toHaveBeenCalledWith('writeFile', expect.any(Function));
	});

	it('registers error event handler', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, [], false);

		expect(mockNitpicker.on).toHaveBeenCalledWith('error', expect.any(Function));
	});

	it('logs write file path on writeFile event', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, [], false);
		consoleSpy.mockClear();

		mockNitpicker.emit('writeFile', { filePath: '/path/to/output.nitpicker' });

		expect(consoleSpy).toHaveBeenCalledWith('  📥 Write file: /path/to/output.nitpicker');
	});

	it('logs error message with Error prefix on error event', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, [], false);

		mockNitpicker.emit('error', { message: 'something went wrong', error: null });

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: something went wrong');
	});

	it('does not print stack trace when verbose is false', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, [], false);

		const err = new Error('fail');
		err.stack = 'Error: fail\n    at test.ts:1:1';
		mockNitpicker.emit('error', { message: 'fail', error: err });

		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: fail');
	});

	it('prints stack trace when verbose is true and error has stack', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, [], true);

		const err = new Error('fail');
		err.stack = 'Error: fail\n    at test.ts:1:1';
		mockNitpicker.emit('error', { message: 'fail', error: err });

		expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
		expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, 'Error: fail');
		expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, 'Error: fail\n    at test.ts:1:1');
	});

	it('does not print stack trace when verbose is true but error is null', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, [], true);

		mockNitpicker.emit('error', { message: 'fail', error: null });

		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: fail');
	});

	it('handles empty start log array', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, [], false);

		// No console.log calls for start lines (only event handlers registered)
		expect(consoleSpy).not.toHaveBeenCalled();
	});
});
