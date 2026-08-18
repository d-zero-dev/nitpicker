import { startViewer } from '@nitpicker/viewer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { formatCliError as formatCliErrorFn } from '../format-cli-error.js';

import { viewer } from './viewer.js';

vi.mock('@nitpicker/viewer', () => ({
	startViewer: vi.fn().mockResolvedValue(),
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

describe('viewer command', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('exits with error when no source is specified', async () => {
		await expect(viewer([], {} as never)).rejects.toThrow(ExitError);

		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('passes an onExtractProgress callback to startViewer (issue #294)', async () => {
		await viewer(['test.nitpicker'], {
			port: undefined,
			host: undefined,
			open: true,
		});

		expect(startViewer).toHaveBeenCalledWith(
			expect.objectContaining({ onExtractProgress: expect.any(Function) }),
		);
	});

	it('renders byte progress to stderr via the passed callback, with no %braille% placeholder leak (issue #294 code review #6)', async () => {
		// Exact match, not `stringContaining`: this command bypasses `Lanes`
		// and writes straight to `process.stderr`, so `createByteProgressLogger`
		// must be called with `{ animated: false }` — a `stringContaining`
		// check would pass even if that option were dropped and the literal
		// `%braille%` placeholder leaked into the output.
		vi.mocked(startViewer).mockImplementationOnce((options) => {
			options.onExtractProgress?.(50_000_000, 200_000_000);
			return Promise.resolve();
		});

		await viewer(['test.nitpicker'], { port: undefined, host: undefined, open: true });

		expect(stderrSpy).toHaveBeenCalledWith('Extracting archive: 50/200 MB (25%)\n');
	});

	it('catches errors from startViewer and exits with error', async () => {
		const error = new Error('boom');
		vi.mocked(startViewer).mockRejectedValueOnce(error);

		await expect(
			viewer(['test.nitpicker'], { port: undefined, host: undefined, open: true }),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(error, false);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
