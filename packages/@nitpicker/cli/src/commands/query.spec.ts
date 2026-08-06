import path from 'node:path';

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { formatCliError as formatCliErrorFn } from '../format-cli-error.js';
import { dispatchQuery as dispatchQueryFn } from '../query/dispatch-query.js';

import { query } from './query.js';

vi.mock('@nitpicker/query', () => ({
	ArchiveManager: vi.fn().mockImplementation(function (this: {
		open: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
	}) {
		this.open = vi.fn().mockResolvedValue({
			archiveId: 'archive_1',
			accessor: {},
		});
		this.close = vi.fn().mockResolvedValue();
	}),
}));

vi.mock('../query/dispatch-query.js', () => ({
	dispatchQuery: vi
		.fn()
		.mockResolvedValue({ baseUrl: 'https://example.com', totalPages: 5 }),
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

describe('query command', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('exits with error when no file path is provided', async () => {
		await expect(query([], {} as never)).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No .nitpicker file specified.');
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Usage: npx @nitpicker/cli query <file> <sub-command> [options]',
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('exits with error when no sub-command is provided', async () => {
		await expect(query(['test.nitpicker'], {} as never)).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No sub-command specified.');
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Valid sub-commands:'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('exits with error for unknown sub-command', async () => {
		await expect(query(['test.nitpicker', 'unknown'], {} as never)).rejects.toThrow(
			ExitError,
		);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Unknown sub-command: unknown');
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('outputs JSON result to stdout on success', async () => {
		await query(['test.nitpicker', 'summary'], { pretty: undefined } as never);

		expect(dispatchQueryFn).toHaveBeenCalledWith(
			expect.anything(),
			'summary',
			expect.objectContaining({ pretty: undefined }),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			JSON.stringify({ baseUrl: 'https://example.com', totalPages: 5 }),
		);
	});

	it('exits with error when ArchiveManager.open fails', async () => {
		const { ArchiveManager } = await import('@nitpicker/query');
		vi.mocked(ArchiveManager).mockImplementationOnce(function (this: {
			open: ReturnType<typeof vi.fn>;
			close: ReturnType<typeof vi.fn>;
		}) {
			this.open = vi.fn().mockRejectedValue(new Error('Failed to open archive'));
			this.close = vi.fn().mockResolvedValue();
		} as never);

		await expect(
			query(['test.nitpicker', 'summary'], { pretty: undefined } as never),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(expect.any(Error), false);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('resolves relative file path via process.cwd()', async () => {
		const { ArchiveManager } = await import('@nitpicker/query');
		await query(['relative/test.nitpicker', 'summary'], { pretty: undefined } as never);

		const managerInstance = vi.mocked(ArchiveManager).mock.results[0]?.value;
		expect(managerInstance.open).toHaveBeenCalledWith(
			path.resolve(process.cwd(), 'relative/test.nitpicker'),
		);
	});

	it('uses absolute file path as-is', async () => {
		const { ArchiveManager } = await import('@nitpicker/query');
		await query(['/absolute/test.nitpicker', 'summary'], { pretty: undefined } as never);

		const managerInstance = vi.mocked(ArchiveManager).mock.results[0]?.value;
		expect(managerInstance.open).toHaveBeenCalledWith('/absolute/test.nitpicker');
	});

	it('pretty-prints when --pretty is set', async () => {
		await query(['test.nitpicker', 'summary'], { pretty: true } as never);

		expect(consoleLogSpy).toHaveBeenCalledWith(
			JSON.stringify({ baseUrl: 'https://example.com', totalPages: 5 }, null, 2),
		);
	});

	it('closes archive after successful query', async () => {
		const { ArchiveManager } = await import('@nitpicker/query');
		await query(['test.nitpicker', 'summary'], { pretty: undefined } as never);

		const managerInstance = vi.mocked(ArchiveManager).mock.results[0]?.value;
		expect(managerInstance.close).toHaveBeenCalledWith('archive_1');
	});

	it('closes archive even when dispatch throws', async () => {
		vi.mocked(dispatchQueryFn).mockRejectedValueOnce(new Error('Query failed'));
		const { ArchiveManager } = await import('@nitpicker/query');

		await expect(
			query(['test.nitpicker', 'summary'], { pretty: undefined } as never),
		).rejects.toThrow(ExitError);

		const managerInstance = vi.mocked(ArchiveManager).mock.results[0]?.value;
		expect(managerInstance.close).toHaveBeenCalledWith('archive_1');
		expect(formatCliErrorFn).toHaveBeenCalledWith(expect.any(Error), false);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});

describe('query commandDef sub-command metadata', () => {
	it('lists exactly the dispatchable sub-commands', async () => {
		const { commandDef } = await import('./query.js');
		const { VALID_SUB_COMMANDS } = await import('../query/types.js');

		expect(Object.keys(commandDef.subCommands).toSorted()).toEqual(
			[...VALID_SUB_COMMANDS].toSorted(),
		);
	});

	it('references only defined flags in every sub-command flag list', async () => {
		const { commandDef } = await import('./query.js');
		const flagKeys = new Set(Object.keys(commandDef.flags));

		for (const [name, sub] of Object.entries(commandDef.subCommands)) {
			for (const key of sub.flags) {
				expect(flagKeys.has(key), `sub-command ${name} references ${key}`).toBe(true);
			}
		}
	});

	it('keeps --pretty as the only flag shared by all sub-commands', async () => {
		const { commandDef } = await import('./query.js');
		const referenced = new Set(
			Object.values(commandDef.subCommands).flatMap((sub) => [...sub.flags]),
		);
		const common = Object.keys(commandDef.flags).filter((key) => !referenced.has(key));

		expect(common).toEqual(['pretty']);
	});
});
