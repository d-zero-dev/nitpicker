import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { formatCliError } from './format-cli-error.js';

describe('formatCliError', () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('prints error message for Error instances', () => {
		formatCliError(new Error('something failed'), false);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: something failed');
	});

	it('does not print stack trace when verbose is false', () => {
		const error = new Error('fail');
		error.stack = 'Error: fail\n    at test.ts:1:1';

		formatCliError(error, false);

		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: fail');
	});

	it('prints stack trace when verbose is true', () => {
		const error = new Error('fail');
		error.stack = 'Error: fail\n    at test.ts:1:1';

		formatCliError(error, true);

		expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
		expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, 'Error: fail');
		expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, 'Error: fail\n    at test.ts:1:1');
	});

	it('handles Error without stack when verbose is true', () => {
		const error = new Error('no stack');
		error.stack = undefined;

		formatCliError(error, true);

		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: no stack');
	});

	it('handles non-Error values', () => {
		formatCliError('string error', false);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: string error');
	});

	it('handles non-Error values with verbose', () => {
		formatCliError(42, true);

		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: 42');
	});

	it('handles null error', () => {
		formatCliError(null, false);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: null');
	});

	it('handles undefined error', () => {
		formatCliError(undefined, false);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: undefined');
	});
});
