import type { CommandDef, InferFlags } from '@d-zero/roar';
import type { Config, CrawlerError } from '@nitpicker/crawler';

import path from 'node:path';

import { readList } from '@d-zero/readtext/list';
import { CrawlerOrchestrator } from '@nitpicker/crawler';

import { log, verbosely } from '../crawl/debug.js';
import { diff } from '../crawl/diff.js';
import { eventAssignments } from '../crawl/event-assignments.js';
import { mapFlagsToCrawlConfig } from '../crawl/map-flags-to-crawl-config.js';
import { ExitCode } from '../exit-code.js';

import { CrawlAggregateError } from './crawl-aggregate-error.js';

/**
 * Command definition for the `crawl` sub-command.
 * Defines all CLI flags with their types, defaults, and descriptions.
 * @see {@link crawl} for the main entry point that dispatches to startCrawl/resumeCrawl/diff
 */
export const commandDef = {
	desc: 'Crawl a website',
	flags: {
		resume: {
			type: 'string',
			shortFlag: 'R',
			desc: 'Resume crawling from a stub file',
		},
		append: {
			type: 'string',
			shortFlag: 'A',
			desc: 'Append crawl: open the given archive and add positional URLs as new recursive roots',
		},
		interval: {
			type: 'number',
			shortFlag: 'I',
			desc: 'An interval time on request when crawls',
		},
		image: {
			type: 'boolean',
			default: true,
			desc: 'Getting images (use --no-image to disable)',
		},
		fetchExternal: {
			type: 'boolean',
			default: true,
			desc: 'Fetch external links (use --no-fetch-external to disable)',
		},
		parallels: {
			type: 'number',
			shortFlag: 'P',
			desc: 'Number of parallel scraping',
		},
		recursive: {
			type: 'boolean',
			default: true,
			desc: 'Recursive crawling (use --no-recursive to disable)',
		},
		scope: {
			type: 'string',
			desc: 'Set hosts and URLs as scope',
		},
		exclude: {
			type: 'string',
			isMultiple: true,
			desc: 'Excluding page URL path (glob pattern)',
		},
		excludeKeyword: {
			type: 'string',
			isMultiple: true,
			desc: 'Exclude keyword in document of page',
		},
		excludeUrl: {
			type: 'string',
			isMultiple: true,
			desc: 'Exclude external URL prefix',
		},
		disableQueries: {
			type: 'boolean',
			shortFlag: 'Q',
			desc: 'Disable queries that the URL has',
		},
		imageFileSizeThreshold: {
			type: 'number',
			desc: 'Image file size threshold',
		},
		single: {
			type: 'boolean',
			desc: 'Single page mode',
		},
		maxExcludedDepth: {
			type: 'number',
			desc: 'Avoid crawling depths above a set number',
		},
		retry: {
			type: 'number',
			default: 3,
			desc: 'Number of retry attempts per URL on scrape failure',
		},
		list: {
			type: 'string',
			isMultiple: true,
			desc: 'Running only each page from the list',
		},
		listFile: {
			type: 'string',
			desc: 'Running only each page from the list file',
		},
		userAgent: {
			type: 'string',
			desc: 'Custom User-Agent string for HTTP requests',
		},
		ignoreRobots: {
			type: 'boolean',
			desc: 'Ignore robots.txt restrictions (use responsibly)',
		},
		output: {
			type: 'string',
			shortFlag: 'o',
			desc: 'Output file path for the .nitpicker archive',
		},
		strict: {
			type: 'boolean',
			desc: 'Treat external link errors as fatal (exit code 1 instead of 2)',
		},
		verbose: {
			type: 'boolean',
			desc: 'Output verbose log to standard out',
		},
		silent: {
			type: 'boolean',
			desc: 'No output log to standard out',
		},
		diff: {
			type: 'boolean',
			desc: 'Diff mode',
		},
	},
} as const satisfies CommandDef;

type CrawlFlags = InferFlags<typeof commandDef.flags>;

type LogType = 'verbose' | 'normal' | 'silent';

/**
 * Sets up signal handlers for graceful shutdown and starts event logging.
 *
 * Registers SIGINT/SIGBREAK/SIGHUP/SIGABRT handlers that abort the
 * crawl via {@link CrawlerOrchestrator.abort}, then kill zombie Chromium
 * processes and exit. The abort signal propagates through the dealer's
 * AbortSignal mechanism so no new workers are launched.
 *
 * Signal handlers are automatically removed in a `finally` block when
 * the event assignment pipeline completes or throws.
 * @param trigger - Display label for the crawl (URL or stub file path)
 * @param orchestrator - The initialized CrawlerOrchestrator instance
 * @param config - The resolved archive configuration
 * @param logType - Output verbosity level
 * @returns A promise that resolves when the event assignment pipeline completes.
 */
async function run(
	trigger: string,
	orchestrator: CrawlerOrchestrator,
	config: Config,
	logType: LogType,
) {
	const killed = () => {
		orchestrator.abort();
		orchestrator.garbageCollect();
		process.exit();
	};
	const signals: NodeJS.Signals[] = ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGABRT'];
	for (const signal of signals) {
		process.on(signal, killed);
	}

	const head = [
		`🐳 ${trigger} (New scraping)`,
		...Object.entries(config).map(([key, value]) => `  ${key}: ${value}`),
	];
	try {
		return await eventAssignments(orchestrator, head, logType);
	} finally {
		for (const signal of signals) {
			process.removeListener(signal, killed);
		}
	}
}

/**
 * Starts a fresh crawl session for the given URLs.
 *
 * Creates a CrawlerOrchestrator, runs the crawl, writes the archive,
 * and cleans up browser processes.
 * @param siteUrl - One or more root URLs to crawl
 * @param flags - Parsed CLI flags from the `crawl` command
 * @returns A promise that resolves with the archive file path when crawling, writing, and cleanup are complete.
 * @throws {CrawlAggregateError} When one or more errors occurred during crawling.
 */
export async function startCrawl(siteUrl: string[], flags: CrawlFlags): Promise<string> {
	const errStack: (CrawlerError | Error)[] = [];

	const isList = !!flags.list?.length;
	const orchestrator = await CrawlerOrchestrator.crawling(
		siteUrl,
		{
			...mapFlagsToCrawlConfig(flags),
			filePath: flags.output,
			list: isList,
			// --single（単一ページモード）および --list モードでは再帰クロールを無効化
			recursive: isList || flags.single ? false : flags.recursive,
		},
		(orchestrator, config) => {
			run(
				config.baseUrl,
				orchestrator,
				config,
				flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal',
			).catch((error) => errStack.push(error));
		},
	);

	try {
		await orchestrator.write();
	} finally {
		await orchestrator.archive.close();
		orchestrator.garbageCollect();
	}

	const archivePath = orchestrator.archive.filePath;

	if (errStack.length > 0) {
		const error = new CrawlAggregateError(errStack);
		// eslint-disable-next-line no-console
		console.error(`\n${error.message}`);
		throw error;
	}

	return archivePath;
}

/**
 * Resumes a previously interrupted crawl from a stub file (temporary directory).
 *
 * Restores the crawl state from the archive, applies any flag overrides,
 * and continues crawling from where the previous session left off.
 * @param stubFilePath - Path to the stub file or temporary directory to resume from
 * @param flags - Parsed CLI flags from the `crawl` command
 * @returns A promise that resolves when crawling, writing, and cleanup are complete.
 */
async function resumeCrawl(stubFilePath: string, flags: CrawlFlags) {
	const errStack: (CrawlerError | Error)[] = [];
	const absFilePath = path.isAbsolute(stubFilePath)
		? stubFilePath
		: path.resolve(process.cwd(), stubFilePath);

	const orchestrator = await CrawlerOrchestrator.resume(
		absFilePath,
		{
			...mapFlagsToCrawlConfig(flags),
			list: false,
		},
		(orchestrator, config) => {
			run(
				stubFilePath,
				orchestrator,
				config,
				flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal',
			).catch((error) => errStack.push(error));
		},
	);

	try {
		await orchestrator.write();
	} finally {
		await orchestrator.archive.close();
		orchestrator.garbageCollect();
	}

	if (errStack.length > 0) {
		const error = new CrawlAggregateError(errStack);
		// eslint-disable-next-line no-console
		console.error(`\n${error.message}`);
		throw error;
	}
}

/**
 * Append a fresh crawl to an existing `.nitpicker` archive.
 *
 * Opens the archive, registers the positional URLs as additional recursive
 * roots, re-scrapes any previously-external pages whose URL now falls under
 * the expanded scope, and writes the result back to the same file. A
 * `<archive>.bak` is taken before any DB mutation; on success it is removed,
 * on failure it is restored.
 * @param archivePath - Path to the existing `.nitpicker` archive.
 * @param newUrls - Positional URLs to append as new roots. Must be non-empty.
 * @param flags - Parsed CLI flags from the `crawl` command.
 */
async function appendCrawl(archivePath: string, newUrls: string[], flags: CrawlFlags) {
	validateUrls(newUrls);
	const errStack: (CrawlerError | Error)[] = [];

	const orchestrator = await CrawlerOrchestrator.append(
		archivePath,
		newUrls,
		{
			...mapFlagsToCrawlConfig(flags),
			list: false,
		},
		(orchestrator, config) => {
			run(
				`${archivePath} (append: ${newUrls.join(', ')})`,
				orchestrator,
				config,
				flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal',
			).catch((error) => errStack.push(error));
		},
	);

	try {
		await orchestrator.write();
	} finally {
		await orchestrator.archive.close();
		orchestrator.garbageCollect();
	}

	if (errStack.length > 0) {
		const error = new CrawlAggregateError(errStack);
		// eslint-disable-next-line no-console
		console.error(`\n${error.message}`);
		throw error;
	}
}

/**
 * Validates that all URLs in the list are parseable by the URL constructor.
 * @param urls - Array of URL strings to validate
 * @throws {Error} If any URL is invalid
 */
function validateUrls(urls: readonly string[]) {
	for (const url of urls) {
		try {
			new URL(url);
		} catch {
			throw new Error(
				`Invalid URL: "${url}". Please provide a valid URL (e.g., https://example.com)`,
			);
		}
	}
}

/**
 * Main entry point for the `crawl` CLI command.
 *
 * Dispatches to one of four modes based on the flags:
 * 1. `--diff` mode: Compares two archive files and outputs URL lists
 * 2. `--resume` mode: Resumes a previously interrupted crawl
 * 3. `--list-file` / `--list` mode: Crawls a pre-defined URL list (non-recursive)
 * 4. Default mode: Crawls from a single root URL
 * @param args - Positional arguments (typically one or two URLs/file paths)
 * @param flags - Parsed CLI flags from the `crawl` command
 * @returns A promise that resolves when the dispatched mode completes.
 */
export async function crawl(args: string[], flags: CrawlFlags) {
	if (flags.verbose && !flags.silent) {
		verbosely();
	}

	log('Options: %O', flags);

	if (flags.diff) {
		if (flags.append) {
			throw new Error('--diff cannot be combined with --append.');
		}
		if (args.length !== 2) {
			throw new Error('--diff takes exactly two file paths to compare');
		}
		await diff(args[0]!, args[1]!);
		return;
	}

	const hasListFlag = !!flags.list && flags.list.length > 0;

	if (flags.single && (hasListFlag || flags.listFile)) {
		// eslint-disable-next-line no-console
		console.warn('Warning: --single is ignored when --list or --list-file is specified.');
	}

	if (flags.single && args.length > 1) {
		throw new Error('--single cannot be combined with multiple positional URLs');
	}

	try {
		if (flags.resume) {
			if (flags.output) {
				throw new Error(
					'--output flag is not supported with --resume. The archive path is determined by the stub file.',
				);
			}
			if (flags.append) {
				throw new Error(
					'--resume and --append cannot be used together. Pick the existing-archive mode that fits your task.',
				);
			}
			await resumeCrawl(flags.resume, flags);
			return;
		}

		if (flags.append) {
			if (flags.output) {
				throw new Error(
					'--output flag is not supported with --append. The archive path is the file being appended.',
				);
			}
			if (flags.listFile) {
				throw new Error('--append cannot be combined with --list-file.');
			}
			if (hasListFlag) {
				throw new Error('--append cannot be combined with --list.');
			}
			if (flags.single) {
				throw new Error('--append cannot be combined with --single.');
			}
			if (args.length === 0) {
				throw new Error('--append requires at least one URL to append.');
			}
			await appendCrawl(flags.append, args, flags);
			return;
		}

		if (flags.listFile) {
			const list = await readList(path.resolve(process.cwd(), flags.listFile));
			if (list.length === 0) {
				throw new Error(`No URLs found in list file: ${flags.listFile}`);
			}
			validateUrls(list);
			flags.list = list;
			await startCrawl(list, flags);
			return;
		}

		if (hasListFlag) {
			const pageList = [...flags.list, ...args];
			validateUrls(pageList);
			await startCrawl(pageList, flags);
			return;
		}

		if (args.length > 0) {
			validateUrls(args);
			await startCrawl(args, flags);
			return;
		}
	} catch (error) {
		if (error instanceof CrawlAggregateError) {
			const exitCode =
				error.hasOnlyExternalErrors && !flags.strict ? ExitCode.Warning : ExitCode.Fatal;
			process.exit(exitCode);
		}
		throw error;
	}
}
