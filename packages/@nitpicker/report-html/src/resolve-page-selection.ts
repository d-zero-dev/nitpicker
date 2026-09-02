import type { HtmlReportDirectoryPrefix } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { countPageListRows } from '@nitpicker/query';

import { PAGE_REPORT_LIMIT } from './page-report-limit.js';
import { parseDirectoryInput } from './parse-directory-input.js';
import { resolveDirectoryPrefixes } from './resolve-directory-prefixes.js';

/** Row-set restriction {@link resolvePageSelection} resolves to. */
export interface PageSelection {
	/** Directory-prefix filters, display form, ready for `collectHtmlReportPages`. */
	readonly directories: string[];
	/** Normalized URL allowlist, or `undefined` when `--urls` was not given. */
	readonly urls: readonly string[] | undefined;
}

interface ResolvePageSelectionOptions {
	readonly accessor: ArchiveAccessor;
	readonly directoryInput?: string;
	/** Already-normalized URLs (via `resolvePageListUrlFilter`), or `undefined` when `--urls` was not given. */
	readonly urls?: readonly string[];
	readonly interactive: boolean;
	readonly onWarn: (message: string) => void;
}

/**
 * Decides the report's page restriction: the `--urls` path (this function's
 * own AND-combination with `--html-dirs`, no interactive prompting, no
 * 10,000-page-limit *enforcement via prompting* since a URL list is expected
 * to already be well under it) or the pre-existing `--html-dirs`-only path
 * (delegated to {@link resolveDirectoryPrefixes} unchanged, including its
 * interactive prompt loop).
 *
 * `--urls` skips `resolveDirectoryPrefixes`'s prompt-forcing flow entirely
 * because that flow's whole purpose — interactively narrowing an
 * unboundedly large report down to size — doesn't apply once the caller has
 * already named the exact pages it wants. The 10,000-page ceiling itself
 * still applies (checked after combining `--urls` with any `--html-dirs`
 * narrowing), so a directory prefix that happens to still leave the
 * URL-restricted set too large is still rejected.
 * @param options - Archive, optional non-interactive directory input,
 *   optional normalized URL allowlist, interactivity, and warning sink.
 * @returns The resolved directory prefixes and URL allowlist to pass to
 *   `collectHtmlReportPages`.
 * @throws {Error} If the `--urls` path's combined row count exceeds the
 *   10,000-page ceiling.
 */
export async function resolvePageSelection(
	options: ResolvePageSelectionOptions,
): Promise<PageSelection> {
	if (options.urls === undefined) {
		const prefixes = await resolveDirectoryPrefixes({
			accessor: options.accessor,
			initialInput: options.directoryInput,
			interactive: options.interactive,
			onWarn: options.onWarn,
		});
		return { directories: prefixes.map((prefix) => prefix.display), urls: undefined };
	}

	const directoryPrefixes: HtmlReportDirectoryPrefix[] = options.directoryInput
		? parseDirectoryInput(options.directoryInput)
		: [];
	const directories = directoryPrefixes.map((prefix) => prefix.display);
	const total = await countPageListRows(options.accessor, {
		urls: options.urls,
		directories,
	});
	if (total > PAGE_REPORT_LIMIT) {
		throw new Error(
			`--urls matched ${total.toLocaleString()} inner page(s)` +
				(directories.length > 0 ? ' after --html-dirs narrowing' : '') +
				`; exceeds the ${PAGE_REPORT_LIMIT.toLocaleString()}-page report limit. Narrow --urls or --html-dirs further.`,
		);
	}
	return { directories, urls: options.urls };
}
