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
		log(mockNitpicker as any, ['line1', 'line2', 'line3']);

		expect(consoleSpy).toHaveBeenCalledTimes(3);
		expect(consoleSpy).toHaveBeenNthCalledWith(1, 'line1');
		expect(consoleSpy).toHaveBeenNthCalledWith(2, 'line2');
		expect(consoleSpy).toHaveBeenNthCalledWith(3, 'line3');
	});

	it('registers writeFile event handler', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, []);

		expect(mockNitpicker.on).toHaveBeenCalledWith('writeFile', expect.any(Function));
	});

	it('registers error event handler', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, []);

		expect(mockNitpicker.on).toHaveBeenCalledWith('error', expect.any(Function));
	});

	it('logs write file path on writeFile event', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, []);
		consoleSpy.mockClear();

		mockNitpicker.emit('writeFile', { filePath: '/path/to/output.nitpicker' });

		expect(consoleSpy).toHaveBeenCalledWith('  📥 Write file: /path/to/output.nitpicker');
	});

	it('logs error message on error event', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, []);

		mockNitpicker.emit('error', { message: 'something went wrong' });

		expect(consoleErrorSpy).toHaveBeenCalledWith('something went wrong');
	});

	it('handles empty start log array', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		log(mockNitpicker as any, []);

		// No console.log calls for start lines (only event handlers registered)
		expect(consoleSpy).not.toHaveBeenCalled();
	});
});
