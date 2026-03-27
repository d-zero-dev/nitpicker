import {
	report as runReport,
	reportLocal as runReportLocal,
} from '@nitpicker/report-google-sheets';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { formatCliError as formatCliErrorFn } from '../format-cli-error.js';
import { verbosely as verboselyFn } from '../report/debug.js';

import { report } from './report.js';

vi.mock('@nitpicker/report-google-sheets', () => ({
	report: vi.fn(),
	reportLocal: vi.fn(),
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

/** Default-shaped flags for Google Sheets mode (matches InferFlags after optional flags). */
const googleReportFlags = {
	local: undefined as boolean | undefined,
	outputDir: undefined as string | undefined,
	sheet: 'https://docs.google.com/spreadsheets/d/xxx',
	credentials: undefined as string | undefined,
	config: undefined as string | undefined,
	limit: 100_000,
	all: undefined as boolean | undefined,
	verbose: undefined as boolean | undefined,
	silent: undefined as boolean | undefined,
};

describe('report command', () => {
	let originalIsTTY: boolean | undefined;
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		originalIsTTY = process.stdout.isTTY;
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
			...googleReportFlags,
			credentials: './credentials.json',
			all: true,
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
			...googleReportFlags,
			credentials: './credentials.json',
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
			...googleReportFlags,
			credentials: './credentials.json',
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
			...googleReportFlags,
			credentials: './credentials.json',
			silent: true,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				silent: true,
			}),
		);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('calls verbosely when --verbose is set without --silent', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			...googleReportFlags,
			credentials: './credentials.json',
			verbose: true,
		});

		expect(verboselyFn).toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('does not call verbosely when both --verbose and --silent are set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			...googleReportFlags,
			credentials: './credentials.json',
			verbose: true,
			silent: true,
		});

		expect(verboselyFn).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('exits with error when no file path is provided', async () => {
		await expect(
			report([], {
				...googleReportFlags,
				credentials: './credentials.json',
			}),
		).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No .nitpicker file specified.');
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Usage: nitpicker report <file> [options]',
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(runReport).not.toHaveBeenCalled();
	});

	it('exits with error when no sheet URL is provided', async () => {
		await expect(
			report(['test.nitpicker'], {
				...googleReportFlags,
				sheet: undefined as unknown as string,
				credentials: './credentials.json',
			}),
		).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Error: No Google Sheets URL specified. Use --sheet <url> or --local for TSV.',
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(runReport).not.toHaveBeenCalled();
	});

	it('catches errors from runReport and exits with error', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const error = new Error('Google API error');
		vi.mocked(runReport).mockRejectedValueOnce(error);

		await expect(
			report(['test.nitpicker'], {
				...googleReportFlags,
				credentials: './credentials.json',
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
				...googleReportFlags,
				credentials: './credentials.json',
				verbose: true,
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
				...googleReportFlags,
				credentials: './credentials.json',
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
				...googleReportFlags,
				credentials: './credentials.json',
				verbose: true,
				silent: true,
			}),
		).rejects.toThrow(ExitError);

		// --silent suppresses debug output but not error stack traces
		expect(formatCliErrorFn).toHaveBeenCalledWith(error, true);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('calls reportLocal with default output dir when --local is set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['/tmp/site.nitpicker'], {
			...googleReportFlags,
			sheet: undefined as unknown as string,
			local: true,
		});

		expect(runReportLocal).toHaveBeenCalledWith(
			expect.objectContaining({
				filePath: '/tmp/site.nitpicker',
				outputDir: expect.stringMatching(/site-report$/),
				all: false,
			}),
		);
		expect(runReport).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('passes custom --output-dir to reportLocal', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			...googleReportFlags,
			sheet: undefined as unknown as string,
			local: true,
			outputDir: '/tmp/out',
		});

		expect(runReportLocal).toHaveBeenCalledWith(
			expect.objectContaining({
				outputDir: '/tmp/out',
			}),
		);
	});

	it('exits when --local is combined with --sheet', async () => {
		await expect(
			report(['test.nitpicker'], {
				...googleReportFlags,
				local: true,
				credentials: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('--sheet cannot be used with --local'),
		);
		expect(runReportLocal).not.toHaveBeenCalled();
	});

	it('exits when --local is combined with --credentials', async () => {
		await expect(
			report(['test.nitpicker'], {
				...googleReportFlags,
				sheet: undefined as unknown as string,
				local: true,
				credentials: './credentials.json',
			}),
		).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('--credentials cannot be used with --local'),
		);
		expect(runReportLocal).not.toHaveBeenCalled();
	});
});
