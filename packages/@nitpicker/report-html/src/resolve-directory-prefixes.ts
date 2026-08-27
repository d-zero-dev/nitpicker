import type { HtmlReportDirectoryPrefix } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { countPageListHostnames, countPageListRows } from '@nitpicker/query';
import enquirer from 'enquirer';

import { parseDirectoryInput } from './parse-directory-input.js';

const PAGE_LIMIT = 10_000;

interface ResolveDirectoryPrefixesOptions {
	readonly accessor: ArchiveAccessor;
	readonly initialInput?: string;
	readonly interactive: boolean;
	readonly onWarn: (message: string) => void;
}

/**
 *
 */
async function promptForInput(): Promise<string> {
	const answer = await enquirer
		.prompt<{ directories: string }>({
			type: 'input',
			name: 'directories',
			message:
				'Filter inner pages by directory (comma-separated full URLs or /pathnames):',
		})
		.catch(() => process.exit(0));
	return answer.directories;
}

/**
 * Resolves and validates the directory prefixes needed to keep a report bounded.
 * @param options - Archive, initial non-interactive value, and warning sink.
 * @returns Valid prefixes whose union contains at most 10,000 pages.
 * @example
 * const prefixes = await resolveDirectoryPrefixes({
 *   accessor,
 *   interactive: process.stdout.isTTY === true,
 *   onWarn: console.warn,
 * });
 */
export async function resolveDirectoryPrefixes(
	options: ResolveDirectoryPrefixesOptions,
): Promise<HtmlReportDirectoryPrefix[]> {
	const unfilteredTotal = await countPageListRows(options.accessor);
	const hostnameCount = await countPageListHostnames(options.accessor);
	let input = options.initialInput;

	if (unfilteredTotal <= PAGE_LIMIT && input == null) {
		return [];
	}

	for (;;) {
		if (input == null) {
			if (!options.interactive) {
				throw new Error(
					`HTML report has ${unfilteredTotal.toLocaleString()} inner pages; ` +
						'use --html-dirs with comma-separated directory prefixes to reduce it to 10,000 or fewer.',
				);
			}
			options.onWarn(
				`HTML report has ${unfilteredTotal.toLocaleString()} inner pages; select directories containing 10,000 or fewer pages.`,
			);
			input = await promptForInput();
		}

		try {
			const prefixes = parseDirectoryInput(input);
			if (hostnameCount > 1 && prefixes.some((prefix) => prefix.origin === null)) {
				throw new Error(
					'This archive contains multiple hosts; every directory prefix must be a full URL.',
				);
			}

			for (const prefix of prefixes) {
				const count = await countPageListRows(options.accessor, {
					directories: [prefix.display],
				});
				if (count === 0) {
					throw new Error(`No inner page matches directory prefix: ${prefix.display}`);
				}
			}

			const selectedTotal = await countPageListRows(options.accessor, {
				directories: prefixes.map((prefix) => prefix.display),
			});
			if (selectedTotal > PAGE_LIMIT) {
				throw new Error(
					`The selected directories contain ${selectedTotal.toLocaleString()} inner pages; narrow them to 10,000 or fewer.`,
				);
			}
			return prefixes;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!options.interactive) {
				throw new Error(`Invalid --html-dirs: ${message}`, { cause: error });
			}
			options.onWarn(`Warning: ${message}`);
			input = await promptForInput();
		}
	}
}
