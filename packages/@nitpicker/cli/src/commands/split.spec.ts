import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { VIEWER_READ_MODEL_FULL_BUILD_PHASES } from '../viewer-read-model-full-build-phases.js';

const mockArchiveClose = vi.fn();
const mockArchiveWrite = vi.fn();
const mockGetCrawlingState = vi.fn();
const mockOpenCached = vi.fn();
const mockArchiveCreate = vi.fn();

vi.mock('@nitpicker/archive/archive', () => ({
	default: { openCached: mockOpenCached, create: mockArchiveCreate },
}));

const mockSplitArchive = vi.fn();

vi.mock('@nitpicker/archive/transfer/split-archive', () => ({
	splitArchive: mockSplitArchive,
}));

const mockBuildViewerReadModelInWorker = vi.fn();

vi.mock('@nitpicker/query', () => ({
	buildViewerReadModelInWorker: mockBuildViewerReadModelInWorker,
}));

const mockClassifyTemplatesQuietly = vi.fn();

vi.mock('../crawl/classify-templates-quietly.js', () => ({
	classifyTemplatesQuietly: mockClassifyTemplatesQuietly,
}));

vi.mock('../transfer/validate-transfer-input-paths.js', () => ({
	validateTransferInputPaths: (paths: string[]) => paths,
}));

vi.mock('../transfer/validate-transfer-output-path.js', () => ({
	validateTransferOutputPath: (output: string) => output,
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

describe('split command', () => {
	let destination: {
		getCrawlingState: typeof mockGetCrawlingState;
		write: typeof mockArchiveWrite;
		close: typeof mockArchiveClose;
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		destination = {
			getCrawlingState: mockGetCrawlingState,
			write: mockArchiveWrite,
			close: mockArchiveClose,
		};
		mockGetCrawlingState.mockResolvedValue({ pending: [] });
		mockArchiveWrite.mockResolvedValue();
		mockArchiveClose.mockResolvedValue();
		mockOpenCached.mockResolvedValue({ close: mockArchiveClose });
		mockArchiveCreate.mockResolvedValue(destination);
		mockClassifyTemplatesQuietly.mockResolvedValue(null);
		// Announces every row's phase, in order, the way the real extraction
		// does: the bridged rows only settle on the next `onPhase` (or the
		// result).
		const { SPLIT_SOURCE_TRANSFER_PHASES } =
			await import('@nitpicker/archive/transfer/split-source-transfer-phases');
		const { TRANSFER_POST_PHASES } =
			await import('@nitpicker/archive/transfer/transfer-post-phases');
		const phaseCount = SPLIT_SOURCE_TRANSFER_PHASES.length + TRANSFER_POST_PHASES.length;
		mockSplitArchive.mockImplementation(
			async (options: { callbacks: { onPhase: (...args: unknown[]) => void } }) => {
				for (let index = 0; index < phaseCount; index++) {
					options.callbacks.onPhase();
					await Promise.resolve();
				}
				return {
					config: { fromList: false, roots: ['https://example.com/blog/'] },
					externalInScopeCount: 0,
				};
			},
		);
		mockBuildViewerReadModelInWorker.mockImplementation(
			async (_archive: unknown, options: { onPhase: (phase: string) => void }) => {
				for (const phase of VIEWER_READ_MODEL_FULL_BUILD_PHASES) {
					options.onPhase(phase);
					await Promise.resolve();
				}
			},
		);
		// The up-front check also reads the environment variable.
		vi.stubEnv('NITPICKER_TEMPLATE_MEMORY_BUDGET', '');
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		process.exitCode = undefined;
	});

	const args = ['/tmp/a.nitpicker', 'https://example.com/blog/'];

	it('passes --template-memory-budget to the re-classification of the extracted archive', async () => {
		const { split } = await import('./split.js');
		await split(args, {
			output: '/tmp/out.nitpicker',
			templateMemoryBudget: 256,
		} as never);

		expect(mockClassifyTemplatesQuietly).toHaveBeenCalledWith(destination, {
			onProgress: expect.any(Function),
			templateMemoryBudget: 256,
		});
	});

	it('leaves the memory limit unset when --template-memory-budget is not given', async () => {
		const { split } = await import('./split.js');
		await split(args, { output: '/tmp/out.nitpicker' } as never);

		expect(mockClassifyTemplatesQuietly).toHaveBeenCalledWith(destination, {
			onProgress: expect.any(Function),
			templateMemoryBudget: undefined,
		});
	});

	it('rejects an invalid --template-memory-budget before opening the archive', async () => {
		const { split } = await import('./split.js');

		await expect(
			split(args, { output: '/tmp/out.nitpicker', templateMemoryBudget: -1 } as never),
		).rejects.toMatchObject({ code: 1 });

		expect(mockOpenCached).not.toHaveBeenCalled();
		expect(mockClassifyTemplatesQuietly).not.toHaveBeenCalled();
	});

	it('does not check the limit when --skip-templates means no classification runs', async () => {
		const { split } = await import('./split.js');

		await expect(
			split(args, {
				output: '/tmp/out.nitpicker',
				skipTemplates: true,
				templateMemoryBudget: -1,
			} as never),
		).resolves.toBeUndefined();

		expect(mockClassifyTemplatesQuietly).not.toHaveBeenCalled();
	});
});
