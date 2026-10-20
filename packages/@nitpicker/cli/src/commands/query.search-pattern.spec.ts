import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { formatCliError as formatCliErrorFn } from '../format-cli-error.js';

import { query } from './query.js';

// `@nitpicker/query` is mocked below, but the pattern check comes from the
// `@nitpicker/query/compile-search-pattern` subpath and runs for real, on the
// native addon: `yarn build` must have produced `lib/` and the `.node` file.
const archiveManagerConstructed = vi.fn();

vi.mock('@nitpicker/query', () => ({
	compileSelector: vi.fn(),
	ArchiveManager: vi.fn().mockImplementation(function (this: {
		open: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
	}) {
		archiveManagerConstructed();
		this.open = vi.fn().mockResolvedValue({ archiveId: 'archive_1', accessor: {} });
		this.close = vi.fn().mockResolvedValue();
	}),
}));

vi.mock('@d-zero/dealer', () => ({
	Lanes: vi.fn().mockImplementation(function (this: {
		update: ReturnType<typeof vi.fn>;
		[Symbol.dispose]: ReturnType<typeof vi.fn>;
	}) {
		this.update = vi.fn();
		this[Symbol.dispose] = vi.fn();
	}),
}));

vi.mock('../query/dispatch-query.js', () => ({
	dispatchQuery: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));

vi.mock('../format-cli-error.js', () => ({
	formatCliError: vi.fn(),
}));

vi.mock('../query/validate-directory-flag.js', () => ({
	validateDirectoryFlag: vi.fn(),
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

describe('query search-html pattern validation', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		{ name: 'a lookahead', pattern: '/(?=a)a/' },
		{ name: 'an unclosed group', pattern: '/(/' },
		{ name: 'an unsupported flag', pattern: '/a/y' },
		{ name: 'a pattern that matches the empty string', pattern: '/a*/' },
	])('rejects $name before opening the archive', async ({ pattern }) => {
		await expect(
			query(['test.nitpicker', 'search-html'], { pattern } as never),
		).rejects.toThrow(ExitError);

		expect(archiveManagerConstructed).not.toHaveBeenCalled();
		expect(formatCliErrorFn).toHaveBeenCalledWith(expect.any(Error), false);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('opens the archive for a pattern that is only valid as text with --literal', async () => {
		await query(['test.nitpicker', 'search-html'], {
			pattern: '/a/y',
			literal: true,
		} as never);

		expect(archiveManagerConstructed).toHaveBeenCalledTimes(1);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('names the flag in the message of a refused pattern', async () => {
		await expect(
			query(['test.nitpicker', 'search-html'], { pattern: '/a/y' } as never),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('Invalid --pattern value: /a/y'),
			}),
			false,
		);
	});

	it('opens the archive for a valid pattern', async () => {
		await query(['test.nitpicker', 'search-html'], { pattern: '/a+/i' } as never);

		expect(archiveManagerConstructed).toHaveBeenCalledTimes(1);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('does not read --pattern for other sub-commands', async () => {
		await query(['test.nitpicker', 'summary'], { pattern: '/(/' } as never);

		expect(archiveManagerConstructed).toHaveBeenCalledTimes(1);
	});
});
