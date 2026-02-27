import type { CommandDef, InferFlags } from '@d-zero/roar';
import type { Config, CrawlerError } from '@nitpicker/crawler';

import path from 'node:path';

import { readList } from '@d-zero/readtext/list';
import { CrawlerOrchestrator } from '@nitpicker/crawler';

import { log, verbosely } from '../crawl/debug.js';
import { diff } from '../crawl/diff.js';
import { eventAssignments } from '../crawl/event-assignments.js';

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
		interval: {
			type: 'number',
			shortFlag: 'I',
			desc: 'An interval time on request when crawles',
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
 * Registers SIGINT/SIGBREAK/SIGHUP/SIGABRT handlers that kill zombie
 * Chromium processes before exiting, then delegates to {@link eventAssignments}
 * for progress output.
 * @param trigger - Display label for the crawl (URL or stub file path)
 * @param orchestrator - The initialized CrawlerOrchestrator instance
 * @param config - The resolved archive configuration
 * @param logType - Output verbosity level
 */
function run(
	trigger: string,
	orchestrator: CrawlerOrchestrator,
	config: Config,
	logType: LogType,
) {
	const killed = () => {
		orchestrator.garbageCollect();
		process.exit();
	};
	process.on('SIGINT', killed);
	process.on('SIGBREAK', killed);
	process.on('SIGHUP', killed);
	process.on('SIGABRT', killed);

	const head = [
		`🐳 ${trigger} (New scraping)`,
		...Object.entries(config).map(([key, value]) => `  ${key}: ${value}`),
	];
	return eventAssignments(orchestrator, head, logType);
}

/**
 * Starts a fresh crawl session for the given URLs.
 *
 * Creates a CrawlerOrchestrator, runs the crawl, writes the archive,
 * and cleans up browser processes. Exits with code 1 if errors occurred.
 * @param siteUrl - One or more root URLs to crawl
 * @param flags - Parsed CLI flags from the `crawl` command
 */
async function startCrawl(siteUrl: string[], flags: CrawlFlags) {
	const errStack: (CrawlerError | Error)[] = [];

	const isList = !!flags.list?.length;
	const orchestrator = await CrawlerOrchestrator.crawling(
		siteUrl,
		{
			...flags,
			scope: flags.scope?.split(',').map((s) => s.trim()),
			list: isList,
			recursive: isList ? false : flags.recursive,
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

	await orchestrator.write();

	orchestrator.garbageCollect();

	if (errStack.length > 0) {
		formatCrawlErrors(errStack);
		process.exit(1);
	}
}

/**
 * Resumes a previously interrupted crawl from a stub file (temporary directory).
 *
 * Restores the crawl state from the archive, applies any flag overrides,
 * and continues crawling from where the previous session left off.
 * @param stubFilePath - Path to the stub file or temporary directory to resume from
 * @param flags - Parsed CLI flags from the `crawl` command
 */
async function resumeCrawl(stubFilePath: string, flags: CrawlFlags) {
	const errStack: (CrawlerError | Error)[] = [];
	const absFilePath = path.isAbsolute(stubFilePath)
		? stubFilePath
		: path.resolve(process.cwd(), stubFilePath);

	const orchestrator = await CrawlerOrchestrator.resume(
		absFilePath,
		{
			...flags,
			scope: flags.scope?.split(',').map((s) => s.trim()),
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

	await orchestrator.write();

	orchestrator.garbageCollect();

	if (errStack.length > 0) {
		formatCrawlErrors(errStack);
		process.exit(1);
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
 */
export async function crawl(args: string[], flags: CrawlFlags) {
	if (flags.verbose && !flags.silent) {
		verbosely();
	}

	log('Options: %O', flags);

	if (flags.diff) {
		const a = args[0];
		const b = args[1];
		if (!a || !b) {
			throw new Error('Please provide two file paths to compare');
		}
		await diff(a, b);
		return;
	}

	if (flags.resume) {
		await resumeCrawl(flags.resume, flags);
		return;
	}

	if (flags.listFile) {
		const list = await readList(path.resolve(process.cwd(), flags.listFile));
		flags.list = list;
		await startCrawl(list, flags);
		return;
	}

	if (flags.list && flags.list.length > 0) {
		const pageList = [...flags.list, ...args];
		await startCrawl(pageList, flags);
		return;
	}

	const siteUrl = args[0];

	if (siteUrl) {
		await startCrawl([siteUrl], flags);
		return;
	}
}

/**
 * Prints a summary of errors that occurred during crawling to stderr.
 * @param errStack - Array of errors collected during the crawl session
 */
function formatCrawlErrors(errStack: (CrawlerError | Error)[]) {
	// eslint-disable-next-line no-console
	console.error(`\nCompleted with ${errStack.length} error(s).`);
}
