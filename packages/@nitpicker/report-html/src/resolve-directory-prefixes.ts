import type { HtmlReportDirectoryPrefix } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { countPageListHostnames, countPageListRows } from '@nitpicker/query';
import enquirer from 'enquirer';

import { HtmlReportCancelledError } from './html-report-cancelled-error.js';
import { PAGE_REPORT_LIMIT } from './page-report-limit.js';
import { parseDirectoryInput } from './parse-directory-input.js';

interface ResolveDirectoryPrefixesOptions {
	readonly accessor: ArchiveAccessor;
	readonly initialInput?: string;
	readonly interactive: boolean;
	readonly onWarn: (message: string) => void;
}

/**
 * Asks for comma-separated directory prefixes on a TTY.
 * @returns The raw input string.
 * @throws {HtmlReportCancelledError} If the prompt is dismissed.
 */
async function promptForInput(): Promise<string> {
	try {
		const answer = await enquirer.prompt<{ directories: string }>({
			type: 'input',
			name: 'directories',
			message:
				'Filter inner pages by directory (comma-separated full URLs or /pathnames):',
		});
		return answer.directories;
	} catch {
		// Why not `process.exit(0)` here (the Sheets reporter does that for
		// enquirer Ctrl+C): this prompt runs under `report()`'s `await using`
		// archive, and exiting the process would skip dispose. Throw so the
		// archive closes; the CLI maps the error to exit code 0.
		throw new HtmlReportCancelledError();
	}
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

	if (unfilteredTotal <= PAGE_REPORT_LIMIT && input == null) {
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
			if (selectedTotal > PAGE_REPORT_LIMIT) {
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
