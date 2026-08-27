import { Lanes } from '@d-zero/dealer';
import { report as runReport } from '@nitpicker/report-google-sheets';
import { report as runHtmlReport } from '@nitpicker/report-html';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { formatCliError as formatCliErrorFn } from '../format-cli-error.js';
import { verbosely as verboselyFn } from '../report/debug.js';

import { report } from './report.js';

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

vi.mock('@nitpicker/report-google-sheets', () => ({
	report: vi.fn(),
}));

vi.mock('@nitpicker/report-html', () => ({
	report: vi.fn(),
}));

vi.mock('../report/debug.js', () => ({
	verbosely: vi.fn(),
}));

vi.mock('../format-cli-error.js', () => ({
	formatCliError: vi.fn(),
}));

/** Sentinel error thrown by the process.exit mock to halt execution. */
class ExitError extends Error {
	/** The exit code passed to process.exit(). */
	readonly code: number;
	constructor(code: number) {
		super(`process.exit(${code})`);
		this.code = code;
	}
}

describe('report command', () => {
	let originalIsTTY: boolean | undefined;
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		// The real `report()` is `async`, so it always returns a thenable —
		// the command chains `.finally()` onto it. A bare `vi.fn()` returns
		// `undefined` and would throw before any assertion ran.
		vi.mocked(runReport).mockResolvedValue();
		vi.mocked(runHtmlReport).mockResolvedValue();
		originalIsTTY = process.stdout.isTTY;
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(process.stdout, 'isTTY', {
			value: originalIsTTY,
			writable: true,
		});
	});

	it('passes all=true when --all flag is set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: true,
			verbose: undefined,
			silent: undefined,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				all: true,
			}),
		);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('passes all=true in non-TTY environment even without --all', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: undefined,
			verbose: undefined,
			silent: undefined,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				all: true,
			}),
		);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('passes all=false in TTY environment without --all', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: undefined,
			verbose: undefined,
			silent: undefined,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				all: false,
			}),
		);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('passes silent=true when --silent flag is set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: undefined,
			verbose: undefined,
			silent: true,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				silent: true,
			}),
		);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('passes an onExtractProgress callback when not silent (issue #294)', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: true,
			verbose: undefined,
			silent: undefined,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				onExtractProgress: expect.any(Function),
			}),
		);
	});

	it('omits onExtractProgress when --silent is set (issue #294)', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: true,
			verbose: undefined,
			silent: true,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				onExtractProgress: undefined,
			}),
		);
		expect(Lanes).not.toHaveBeenCalled();
	});

	it('renders byte progress through a stderr Lanes line', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		vi.mocked(runReport).mockImplementationOnce((options) => {
			options.onExtractProgress?.(50_000_000, 200_000_000);
			return Promise.resolve();
		});

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: true,
			verbose: undefined,
			silent: undefined,
		});

		expect(Lanes).toHaveBeenCalledWith(
			expect.objectContaining({ verbose: false, stream: process.stderr }),
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Extracting archive: 50/200 MB (25%)',
		);
		expect(stderrSpy).not.toHaveBeenCalled();
		// Extraction that stops short of 100% is closed by the `finally`
		// wrapping the `runReport` call, not by the progress callback.
		expect(mockLanesClose).toHaveBeenCalled();
	});

	it('creates no Lanes when the callback never fires (tar-cache hit)', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: true,
			verbose: undefined,
			silent: undefined,
		});

		expect(Lanes).not.toHaveBeenCalled();
	});

	it('keeps the Lanes open mid-extraction and closes it the moment 100% arrives', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		let closeCallsAtHalf = -1;
		let closeCallsAtFull = -1;
		vi.mocked(runReport).mockImplementationOnce((options) => {
			options.onExtractProgress?.(100_000_000, 200_000_000);
			closeCallsAtHalf = mockLanesClose.mock.calls.length;
			options.onExtractProgress?.(200_000_000, 200_000_000);
			closeCallsAtFull = mockLanesClose.mock.calls.length;
			return Promise.resolve();
		});

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: true,
			verbose: undefined,
			silent: undefined,
		});

		expect(closeCallsAtHalf).toBe(0);
		expect(closeCallsAtFull).toBe(1);
	});

	it('never constructs a second Lanes when a stray callback arrives after 100%', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		vi.mocked(runReport).mockImplementationOnce((options) => {
			options.onExtractProgress?.(200_000_000, 200_000_000);
			options.onExtractProgress?.(200_000_000, 200_000_000);
			return Promise.resolve();
		});

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: true,
			verbose: undefined,
			silent: undefined,
		});

		expect(Lanes).toHaveBeenCalledTimes(1);
	});

	it('closes the Lanes before formatCliError when extraction throws mid-stream', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const error = new Error('untar failed');
		vi.mocked(runReport).mockImplementationOnce((options) => {
			options.onExtractProgress?.(50_000_000, 200_000_000);
			return Promise.reject(error);
		});
		const callOrder: string[] = [];
		mockLanesClose.mockImplementationOnce(() => {
			callOrder.push('close');
		});
		vi.mocked(formatCliErrorFn).mockImplementationOnce(() => {
			callOrder.push('formatCliError');
		});

		await expect(
			report(['test.nitpicker'], {
				sheet: 'https://docs.google.com/spreadsheets/d/xxx',
				credentials: './credentials.json',
				config: undefined,
				all: true,
				verbose: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(callOrder).toEqual(['close', 'formatCliError']);
		expect(formatCliErrorFn).toHaveBeenCalledWith(error, false);
	});

	it('renders timestamped append-mode Lanes lines when --verbose is set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		vi.mocked(runReport).mockImplementationOnce((options) => {
			options.onExtractProgress?.(50_000_000, 200_000_000);
			return Promise.resolve();
		});

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: true,
			verbose: true,
			silent: undefined,
		});

		expect(Lanes).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringMatching(
				/^\d{4}-\d{2}-\d{2}T[\d:.]+Z %braille% Extracting archive: 50\/200 MB \(25%\)$/,
			),
		);
	});

	it('calls verbosely when --verbose is set without --silent', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: undefined,
			verbose: true,
			silent: undefined,
		});

		expect(verboselyFn).toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('does not call verbosely when both --verbose and --silent are set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			all: undefined,
			verbose: true,
			silent: true,
		});

		expect(verboselyFn).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('exits with error when no file path is provided', async () => {
		await expect(
			report([], {
				sheet: 'https://docs.google.com/spreadsheets/d/xxx',
				credentials: './credentials.json',
				config: undefined,
				all: undefined,
				verbose: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No .nitpicker file specified.');
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Usage: npx @nitpicker/cli report <file> [options]',
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(runReport).not.toHaveBeenCalled();
	});

	it('exits with error when neither output is selected', async () => {
		await expect(
			report(['test.nitpicker'], {
				sheet: undefined as unknown as string,
				credentials: './credentials.json',
				config: undefined,
				all: undefined,
				verbose: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Error: Choose exactly one output: --sheet <url> or --html.',
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(runReport).not.toHaveBeenCalled();
	});

	it('delegates --html reports without loading Google credentials', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			html: true,
			output: './report.html',
			htmlDirs: '/docs',
			sheet: undefined,
			credentials: './credentials.json',
			config: undefined,
			all: undefined,
			verbose: undefined,
			silent: undefined,
		});

		expect(runHtmlReport).toHaveBeenCalledWith(
			expect.objectContaining({
				filePath: 'test.nitpicker',
				outputPath: './report.html',
				directoryInput: '/docs',
				interactive: true,
			}),
		);
		expect(runReport).not.toHaveBeenCalled();
	});

	it('rejects selecting both Sheets and HTML outputs', async () => {
		await expect(
			report(['test.nitpicker'], {
				html: true,
				sheet: 'https://docs.google.com/spreadsheets/d/xxx',
				credentials: './credentials.json',
				config: undefined,
				all: undefined,
				verbose: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Error: Choose exactly one output: --sheet <url> or --html.',
		);
		expect(runReport).not.toHaveBeenCalled();
		expect(runHtmlReport).not.toHaveBeenCalled();
	});

	it('exits 0 when the HTML directory prompt is cancelled', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const cancelled = new Error('HTML report cancelled');
		cancelled.name = 'HtmlReportCancelledError';
		vi.mocked(runHtmlReport).mockRejectedValueOnce(cancelled);

		await expect(
			report(['test.nitpicker'], {
				html: true,
				sheet: undefined,
				credentials: './credentials.json',
				config: undefined,
				all: undefined,
				verbose: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).not.toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	it('catches errors from runReport and exits with error', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const error = new Error('Google API error');
		vi.mocked(runReport).mockRejectedValueOnce(error);

		await expect(
			report(['test.nitpicker'], {
				sheet: 'https://docs.google.com/spreadsheets/d/xxx',
				credentials: './credentials.json',
				config: undefined,
				all: undefined,
				verbose: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(error, false);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('passes verbose=true to formatCliError when --verbose is set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const error = new Error('Google API error');
		vi.mocked(runReport).mockRejectedValueOnce(error);

		await expect(
			report(['test.nitpicker'], {
				sheet: 'https://docs.google.com/spreadsheets/d/xxx',
				credentials: './credentials.json',
				config: undefined,
				all: undefined,
				verbose: true,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(error, true);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('passes verbose=true to formatCliError in non-TTY environment', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true });
		const error = new Error('Google API error');
		vi.mocked(runReport).mockRejectedValueOnce(error);

		await expect(
			report(['test.nitpicker'], {
				sheet: 'https://docs.google.com/spreadsheets/d/xxx',
				credentials: './credentials.json',
				config: undefined,
				all: undefined,
				verbose: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(error, true);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('verbose for formatCliError is independent of --silent flag', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const error = new Error('Google API error');
		vi.mocked(runReport).mockRejectedValueOnce(error);

		await expect(
			report(['test.nitpicker'], {
				sheet: 'https://docs.google.com/spreadsheets/d/xxx',
				credentials: './credentials.json',
				config: undefined,
				all: undefined,
				verbose: true,
				silent: true,
			}),
		).rejects.toThrow(ExitError);

		// --silent suppresses debug output but not error stack traces
		expect(formatCliErrorFn).toHaveBeenCalledWith(error, true);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
