import type { PageSource } from '@nitpicker/query';

/** Every valid {@link PageSource} value, for the runtime guard below. */
const PAGE_SOURCES: readonly PageSource[] = [
	'crawled',
	'inventory-seed',
	'inventory-discovered',
];

/**
 * Parses a raw query-string value into a {@link PageSource}.
 *
 * Returns `undefined` for missing or unrecognised values, matching the
 * silent-drop convention `toContentTypeCategory` / `toBoolean` / `toNumber`
 * use in this directory — a stale/garbage value falls back to "no filter"
 * rather than a 500.
 * @param raw - The raw query-string value.
 * @returns The narrowed source or `undefined`.
 */
export function toPageSource(raw: string | undefined): PageSource | undefined {
	if (!raw) {
		return undefined;
	}
	return (PAGE_SOURCES as readonly string[]).includes(raw)
		? (raw as PageSource)
		: undefined;
}
