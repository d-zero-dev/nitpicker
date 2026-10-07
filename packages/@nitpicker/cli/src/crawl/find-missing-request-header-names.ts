/**
 * Finds header names the archive recorded but this run did not supply.
 *
 * Header values are never persisted, so a `--resume` / `--append` /
 * `--retry-failed` / `--recrawl` / `--inventory` run must be given the headers
 * again. Forgetting them does not fail loudly — the crawl proceeds
 * unauthenticated and the protected pages come back 401/403 — so the caller
 * uses this to warn.
 * @param archivedNames - `requestHeaderNames` stored in the archive.
 * @param suppliedHeaders - The headers given on this run's command line, if any.
 * @returns Archived names with no (case-insensitive) match among the supplied headers.
 * @example
 * findMissingRequestHeaderNames(['Authorization', 'X-Api-Key'], { authorization: 'x' });
 * // => ['X-Api-Key']
 */
export function findMissingRequestHeaderNames(
	archivedNames: readonly string[] | undefined,
	suppliedHeaders?: Readonly<Record<string, string>>,
): string[] {
	const supplied = new Set(
		Object.keys(suppliedHeaders ?? {}).map((n) => n.toLowerCase()),
	);
	return (archivedNames ?? []).filter((name) => !supplied.has(name.toLowerCase()));
}
