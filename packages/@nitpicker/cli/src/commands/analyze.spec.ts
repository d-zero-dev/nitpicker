import { Lanes } from '@d-zero/dealer';
import { Nitpicker } from '@nitpicker/core';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { verbosely as verboselyFn } from '../analyze/debug.js';
import { log as logFn } from '../analyze/log.js';
import { selectPlugins as selectPluginsFn } from '../analyze/select-plugins.js';
import { formatCliError as formatCliErrorFn } from '../format-cli-error.js';

import { analyze } from './analyze.js';

vi.mock('@d-zero/dealer', () => ({
	Lanes: vi.fn().mockImplementation(function (this: { close: ReturnType<typeof vi.fn> }) {
		this.close = vi.fn();
	}),
}));

vi.mock('@nitpicker/core', () => ({
	Nitpicker: {
		open: vi.fn(),
	},
	readPluginLabels: vi.fn(),
}));

vi.mock('enquirer', () => ({
	default: {
		prompt: vi.fn(),
	},
}));

vi.mock('../analyze/build-plugin-overrides.js', () => ({
	buildPluginOverrides: vi.fn(() => ({})),
}));

vi.mock('../analyze/debug.js', () => ({
	verbosely: vi.fn(),
}));

vi.mock('../analyze/log.js', () => ({
	log: vi.fn(),
}));

vi.mock('../analyze/select-plugins.js', () => ({
	selectPlugins: vi.fn(),
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

/** Default config for mock Nitpicker instances. */
const DEFAULT_CONFIG = { analyze: [{ name: '@nitpicker/analyze-axe' }] };

/**
 * Creates a mock Nitpicker instance with configurable plugin list.
 * @param config - The config to return from getConfig()
 */
function createMockNitpicker(config = DEFAULT_CONFIG) {
	return {
		archive: {
			getUrl: vi.fn().mockResolvedValue('https://example.com'),
			close: vi.fn().mockResolvedValue(),
		},
		getConfig: vi.fn().mockResolvedValue(config),
		setPluginOverrides: vi.fn(),
		analyze: vi.fn().mockResolvedValue(),
		write: vi.fn().mockResolvedValue(),
		on: vi.fn(),
	};
}

describe('analyze command', () => {
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
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(process.stdout, 'isTTY', {
			value: originalIsTTY,
			writable: true,
		});
	});

	it('exits with error when no file path is provided', async () => {
		await expect(
			analyze([], {
				all: undefined,
				plugin: undefined,
				verbose: undefined,
				searchKeywords: undefined,
				searchScope: undefined,
				mainContentSelector: undefined,
				axeLang: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No .nitpicker file specified.');
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Usage: nitpicker analyze <file> [options]',
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('calls verbosely when --verbose is set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const mockNitpicker = createMockNitpicker();
		vi.mocked(Nitpicker.open).mockResolvedValue(mockNitpicker as never);
		vi.mocked(selectPluginsFn).mockResolvedValue();

		await analyze(['test.nitpicker'], {
			all: true,
			plugin: undefined,
			verbose: true,
			searchKeywords: undefined,
			searchScope: undefined,
			mainContentSelector: undefined,
			axeLang: undefined,
			silent: undefined,
		});

		expect(verboselyFn).toHaveBeenCalled();
	});

	it('does not call verbosely when --verbose is not set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const mockNitpicker = createMockNitpicker();
		vi.mocked(Nitpicker.open).mockResolvedValue(mockNitpicker as never);
		vi.mocked(selectPluginsFn).mockResolvedValue();

		await analyze(['test.nitpicker'], {
			all: true,
			plugin: undefined,
			verbose: undefined,
			searchKeywords: undefined,
			searchScope: undefined,
			mainContentSelector: undefined,
			axeLang: undefined,
			silent: undefined,
		});

		expect(verboselyFn).not.toHaveBeenCalled();
	});

	it('sets verbose=true in non-TTY environment', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true });
		const mockNitpicker = createMockNitpicker();
		vi.mocked(Nitpicker.open).mockResolvedValue(mockNitpicker as never);
		vi.mocked(selectPluginsFn).mockResolvedValue();

		await analyze(['test.nitpicker'], {
			all: true,
			plugin: undefined,
			verbose: undefined,
			searchKeywords: undefined,
			searchScope: undefined,
			mainContentSelector: undefined,
			axeLang: undefined,
			silent: undefined,
		});

		expect(logFn).toHaveBeenCalledWith(mockNitpicker, expect.any(Array), true);
		expect(Lanes).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
	});

	it('sets verbose=false in TTY environment without --verbose', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const mockNitpicker = createMockNitpicker();
		vi.mocked(Nitpicker.open).mockResolvedValue(mockNitpicker as never);
		vi.mocked(selectPluginsFn).mockResolvedValue();

		await analyze(['test.nitpicker'], {
			all: true,
			plugin: undefined,
			verbose: undefined,
			searchKeywords: undefined,
			searchScope: undefined,
			mainContentSelector: undefined,
			axeLang: undefined,
			silent: undefined,
		});

		expect(logFn).toHaveBeenCalledWith(mockNitpicker, expect.any(Array), false);
		expect(Lanes).toHaveBeenCalledWith(expect.objectContaining({ verbose: false }));
	});

	it('suppresses log output when --silent is set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const mockNitpicker = createMockNitpicker();
		vi.mocked(Nitpicker.open).mockResolvedValue(mockNitpicker as never);
		vi.mocked(selectPluginsFn).mockResolvedValue();

		await analyze(['test.nitpicker'], {
			all: true,
			plugin: undefined,
			verbose: undefined,
			searchKeywords: undefined,
			searchScope: undefined,
			mainContentSelector: undefined,
			axeLang: undefined,
			silent: true,
		});

		expect(verboselyFn).not.toHaveBeenCalled();
		expect(logFn).not.toHaveBeenCalled();
		expect(Lanes).not.toHaveBeenCalled();
	});

	it('silent overrides verbose', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const mockNitpicker = createMockNitpicker();
		vi.mocked(Nitpicker.open).mockResolvedValue(mockNitpicker as never);
		vi.mocked(selectPluginsFn).mockResolvedValue();

		await analyze(['test.nitpicker'], {
			all: true,
			plugin: undefined,
			verbose: true,
			searchKeywords: undefined,
			searchScope: undefined,
			mainContentSelector: undefined,
			axeLang: undefined,
			silent: true,
		});

		expect(verboselyFn).not.toHaveBeenCalled();
		expect(logFn).not.toHaveBeenCalled();
		expect(Lanes).not.toHaveBeenCalled();
	});

	it('exits with error when no plugins found', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const mockNitpicker = createMockNitpicker({ analyze: [] });
		vi.mocked(Nitpicker.open).mockResolvedValue(mockNitpicker as never);

		await expect(
			analyze(['test.nitpicker'], {
				all: undefined,
				plugin: undefined,
				verbose: undefined,
				searchKeywords: undefined,
				searchScope: undefined,
				mainContentSelector: undefined,
				axeLang: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(
			expect.objectContaining({
				message:
					'No analyze plugins found. Install @nitpicker/analyze-* packages or configure them in .nitpickerrc.',
			}),
			false,
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('exits with error when all --plugin names are unknown', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const mockNitpicker = createMockNitpicker({
			analyze: [{ name: '@nitpicker/analyze-axe' }],
		});
		vi.mocked(Nitpicker.open).mockResolvedValue(mockNitpicker as never);
		vi.mocked(selectPluginsFn).mockResolvedValue([]);

		await expect(
			analyze(['test.nitpicker'], {
				all: undefined,
				plugin: ['@nitpicker/analyze-unknown'],
				verbose: undefined,
				searchKeywords: undefined,
				searchScope: undefined,
				mainContentSelector: undefined,
				axeLang: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Unknown plugin(s): @nitpicker/analyze-unknown\nAvailable plugins: @nitpicker/analyze-axe',
		);
		expect(formatCliErrorFn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'No valid plugins to run.' }),
			false,
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('catches errors from Nitpicker.open and exits with error', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const openError = new Error('File not found');
		vi.mocked(Nitpicker.open).mockRejectedValue(openError);

		await expect(
			analyze(['test.nitpicker'], {
				all: undefined,
				plugin: undefined,
				verbose: undefined,
				searchKeywords: undefined,
				searchScope: undefined,
				mainContentSelector: undefined,
				axeLang: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(openError, false);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('passes verbose=true to formatCliError when --verbose is set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const openError = new Error('File not found');
		vi.mocked(Nitpicker.open).mockRejectedValue(openError);

		await expect(
			analyze(['test.nitpicker'], {
				all: undefined,
				plugin: undefined,
				verbose: true,
				searchKeywords: undefined,
				searchScope: undefined,
				mainContentSelector: undefined,
				axeLang: undefined,
				silent: undefined,
			}),
		).rejects.toThrow(ExitError);

		expect(formatCliErrorFn).toHaveBeenCalledWith(openError, true);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('completes successfully in happy path', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
		const mockNitpicker = createMockNitpicker();
		vi.mocked(Nitpicker.open).mockResolvedValue(mockNitpicker as never);
		vi.mocked(selectPluginsFn).mockResolvedValue();

		await analyze(['test.nitpicker'], {
			all: true,
			plugin: undefined,
			verbose: undefined,
			searchKeywords: undefined,
			searchScope: undefined,
			mainContentSelector: undefined,
			axeLang: undefined,
			silent: undefined,
		});

		expect(mockNitpicker.analyze).toHaveBeenCalled();
		expect(mockNitpicker.write).toHaveBeenCalled();
		expect(mockNitpicker.archive.close).toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
	});
});
