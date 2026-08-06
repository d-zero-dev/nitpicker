import type { CommandDef, InferFlags } from '@d-zero/roar';

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import {
	clearArchiveCacheEntry,
	clearArchiveCacheRoot,
	computeArchiveCacheKey,
	getArchiveCacheRoot,
	listArchiveCacheEntries,
	resolveArchiveCacheDir,
} from '@nitpicker/crawler';

import { ExitCode } from '../exit-code.js';
import { formatCacheList } from '../format-cache-list.js';
import { formatCliError } from '../format-cli-error.js';

/**
 * Command definition for the `cache` sub-command.
 * @see {@link cache} for the main entry point
 */
export const commandDef = {
	desc: 'List or clear on-disk viewer caches (tar-extraction cache and the analyze table cache)',
	usage: ['list [options]', 'clear [archive]'],
	flags: {
		json: {
			type: 'boolean',
			desc: 'Output as JSON instead of a human-readable table',
		},
	},
	subCommands: {
		list: {
			desc: 'List cache entries with their size and last-updated time',
			usage: 'list [options]',
			flags: ['json'],
		},
		clear: {
			desc: 'Delete all caches, or only the caches of the given archive',
			usage: 'clear [archive]',
			flags: [],
		},
	},
} as const satisfies CommandDef;

/** Parsed flag values for the `cache` CLI command. */
type CacheFlags = InferFlags<typeof commandDef.flags>;

/** The two sub-commands `cache` accepts. */
const VALID_SUB_COMMANDS = ['list', 'clear'] as const;

/** A validated `cache` sub-command name. */
type CacheSubCommand = (typeof VALID_SUB_COMMANDS)[number];

/**
 * Main entry point for the `cache` CLI command.
 *
 * Lists or clears the on-disk caches shared by viewer / MCP / query CLI
 * (the tar-extraction cache under `getArchiveCacheRoot()`) and by the
 * `analyze` command (the sibling `table` cache). Does not touch the viewer
 * read model (`viewer-build --force` owns that) or any in-process cache
 * (those die with their process).
 * @param args - Positional arguments; first is the sub-command
 *   (`list`/`clear`), second is an optional `.nitpicker` archive path for
 *   `clear`.
 * @param flags - Parsed CLI flags from the `cache` command.
 * @returns Resolves when the sub-command completes.
 *   Exits with code 1 if the sub-command is missing/invalid or an error occurs.
 * @example
 * ```sh
 * npx @nitpicker/cli cache list --json
 * npx @nitpicker/cli cache clear ./site.nitpicker
 * ```
 */
export async function cache(args: string[], flags: CacheFlags): Promise<void> {
	const subCommandArg = args[0];
	if (!subCommandArg || !VALID_SUB_COMMANDS.includes(subCommandArg as CacheSubCommand)) {
		// eslint-disable-next-line no-console
		console.error(
			subCommandArg
				? `Error: Unknown sub-command: ${subCommandArg}`
				: 'Error: No sub-command specified.',
		);
		// eslint-disable-next-line no-console
		console.error(
			`Usage: npx @nitpicker/cli cache <${VALID_SUB_COMMANDS.join('|')}> [archive] [--json]`,
		);
		process.exit(ExitCode.Fatal);
	}

	const cacheRoot = getArchiveCacheRoot();
	if (subCommandArg === 'list') {
		await runList(cacheRoot, flags);
		return;
	}
	await runClear(cacheRoot, args[1]);
}

/**
 * Implements `nitpicker cache list`.
 * @param cacheRoot - Absolute path to the cache root to inspect.
 * @param flags - Parsed CLI flags; only `json` is relevant here.
 */
async function runList(cacheRoot: string, flags: CacheFlags): Promise<void> {
	try {
		const entries = await listArchiveCacheEntries(cacheRoot);
		if (flags.json) {
			// eslint-disable-next-line no-console
			console.log(JSON.stringify(entries));
		} else {
			// eslint-disable-next-line no-console
			console.log(formatCacheList(entries, cacheRoot));
		}
	} catch (error) {
		formatCliError(error, false);
		process.exit(ExitCode.Fatal);
	}
}

/**
 * Implements `nitpicker cache clear [archive]`.
 *
 * With no `archiveArg`, removes the entire cache root (the tar-extraction
 * cache and the sibling `table` cache together). With `archiveArg`, removes
 * only that archive's tar-cache entry — the `table` cache is not
 * archive-scoped and is never touched by this branch.
 * @param cacheRoot - Absolute path to the cache root.
 * @param archiveArg - Optional `.nitpicker` file path from the CLI args.
 */
async function runClear(
	cacheRoot: string,
	archiveArg: string | undefined,
): Promise<void> {
	if (!archiveArg) {
		try {
			const removed = await clearArchiveCacheRoot(cacheRoot);
			// eslint-disable-next-line no-console
			console.log(
				removed
					? `Removed cache root: ${cacheRoot}`
					: `Cache root did not exist (already empty): ${cacheRoot}`,
			);
		} catch (error) {
			formatCliError(error, false);
			process.exit(ExitCode.Fatal);
		}
		return;
	}

	const absArchivePath = path.isAbsolute(archiveArg)
		? archiveArg
		: path.resolve(process.cwd(), archiveArg);

	if (!existsSync(absArchivePath)) {
		// eslint-disable-next-line no-console
		console.log(`Archive not found (nothing to clear): ${absArchivePath}`);
		return;
	}

	if (!statSync(absArchivePath).isFile()) {
		// eslint-disable-next-line no-console
		console.error(
			`Error: Not a .nitpicker file (stub crawl directories are not supported): ${absArchivePath}`,
		);
		process.exit(ExitCode.Fatal);
	}

	try {
		const cacheKey = await computeArchiveCacheKey(absArchivePath);
		const cacheDir = resolveArchiveCacheDir(cacheRoot, cacheKey, absArchivePath);
		const removed = await clearArchiveCacheEntry(cacheDir);
		// eslint-disable-next-line no-console
		console.log(
			removed
				? `Removed cache entry for ${absArchivePath}: ${cacheDir}`
				: `No cache entry matches the current content of ${absArchivePath} (nothing to clear here). ` +
						`Note: stale entries from a previous version of this file are not found by ` +
						`content-addressed lookup — use 'npx @nitpicker/cli cache list' + 'npx @nitpicker/cli cache clear' ` +
						`(no argument) to remove them.`,
		);
	} catch (error) {
		formatCliError(error, false);
		process.exit(ExitCode.Fatal);
	}
}
