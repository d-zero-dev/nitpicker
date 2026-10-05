import { Lanes } from '@d-zero/dealer';
import { startViewer } from '@nitpicker/viewer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { formatCliError as formatCliErrorFn } from '../format-cli-error.js';

import { viewer } from './viewer.js';

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

const defaultFlags = { port: undefined, host: undefined, open: true };

describe('viewer command', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;
	const originalIsTTY = process.stderr.isTTY;

	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true });
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	});

	afterEach(() => {
		Object.defineProperty(process.stderr, 'isTTY', {
			value: originalIsTTY,
			writable: true,
		});
		vi.restoreAllMocks();
	});

	it('exits with error when no source is specified', async () => {
		await expect(viewer([], {} as never)).rejects.toThrow(ExitError);

		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('passes an onExtractProgress callback to startViewer (issue #294)', async () => {
		await viewer(['test.nitpicker'], defaultFlags);

		expect(startViewer).toHaveBeenCalledWith(
			expect.objectContaining({ onExtractProgress: expect.any(Function) }),
		);
	});

	it('renders byte progress through a stderr Lanes line, not appended stderr writes (issue #294)', async () => {
		vi.mocked(startViewer).mockImplementationOnce((options) => {
			options.onExtractProgress?.(50_000_000, 200_000_000);
			return Promise.resolve();
		});

		await viewer(['test.nitpicker'], defaultFlags);

		expect(Lanes).toHaveBeenCalledWith(
			expect.objectContaining({ verbose: false, stream: process.stderr }),
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			0,
			'%braille% Extracting archive: 50/200 MB (25%)',
		);
		expect(stderrSpy).not.toHaveBeenCalled();
	});

	it('creates no Lanes when the callback never fires (stub / tar-cache hit)', async () => {
		await viewer(['test.nitpicker'], defaultFlags);

		expect(Lanes).not.toHaveBeenCalled();
	});

	it('keeps the Lanes open mid-extraction and closes it the moment 100% arrives', async () => {
		let closeCallsAtHalf = -1;
		let closeCallsAtFull = -1;
		vi.mocked(startViewer).mockImplementationOnce(async (options) => {
			options.onExtractProgress?.(100_000_000, 200_000_000);
			closeCallsAtHalf = mockLanesClose.mock.calls.length;
			options.onExtractProgress?.(200_000_000, 200_000_000);
			closeCallsAtFull = mockLanesClose.mock.calls.length;
			// Stay "resident" a tick so the 100% close is observed before
			// the `.finally()` close at shutdown.
			await Promise.resolve();
		});

		await viewer(['test.nitpicker'], defaultFlags);

		expect(closeCallsAtHalf).toBe(0);
		expect(closeCallsAtFull).toBe(1);
	});

	it('never constructs a second Lanes when a stray callback arrives after 100%', async () => {
		vi.mocked(startViewer).mockImplementationOnce((options) => {
			options.onExtractProgress?.(200_000_000, 200_000_000);
			options.onExtractProgress?.(200_000_000, 200_000_000);
			return Promise.resolve();
		});

		await viewer(['test.nitpicker'], defaultFlags);

		expect(Lanes).toHaveBeenCalledTimes(1);
	});

	it('closes the Lanes before formatCliError when extraction throws mid-stream', async () => {
		const error = new Error('untar failed');
		vi.mocked(startViewer).mockImplementationOnce((options) => {
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

		await expect(viewer(['test.nitpicker'], defaultFlags)).rejects.toThrow(ExitError);

		expect(callOrder).toEqual(['close', 'formatCliError']);
		expect(formatCliErrorFn).toHaveBeenCalledWith(error, false);
	});

	it('renders timestamped append-mode Lanes lines when stderr is not a TTY', async () => {
		Object.defineProperty(process.stderr, 'isTTY', { value: false, writable: true });
		vi.mocked(startViewer).mockImplementationOnce((options) => {
			options.onExtractProgress?.(50_000_000, 200_000_000);
			return Promise.resolve();
		});

		await viewer(['test.nitpicker'], defaultFlags);

		expect(Lanes).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			0,
			expect.stringMatching(
				/^\d{4}-\d{2}-\d{2}T[\d:.]+Z %braille% Extracting archive: 50\/200 MB \(25%\)$/,
			),
		);
	});

	it('catches errors from startViewer and exits with error', async () => {
		const error = new Error('boom');
		vi.mocked(startViewer).mockRejectedValueOnce(error);

		await expect(viewer(['test.nitpicker'], defaultFlags)).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(error, false);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
