import type { CreateStripHeadersOnRedirectParams } from './types.js';

/**
 * The slice of `follow-redirects`' per-hop request options this module reads
 * and mutates. `follow-redirects` hands `beforeRedirect` its internal
 * options object, already rewritten for the next hop.
 */
interface RedirectHopOptions {
	href?: string;
	protocol?: string | null;
	hostname?: string | null;
	port?: string | number | null;
	path?: string | null;
	headers?: Record<string, unknown> | readonly string[];
}

/**
 * Builds the `beforeRedirect` hook for `follow-redirects` that removes the
 * user-supplied extra request headers when a redirect leaves the crawl scope.
 *
 * WHY: `follow-redirects` only drops `Authorization` / `Cookie` when the
 * redirect crosses to another host (or downgrades https → http); it keeps any
 * custom header (`X-Api-Key`, …) and it keeps `Authorization` for a different
 * path on the same host. A scope is a `(hostname, port, path)` triple, so an
 * in-scope URL can redirect to an out-of-scope path or port that the scope
 * rule must still treat as external. Judging each hop with the same scope
 * predicate the rest of the crawler uses keeps a single definition of
 * "where credentials may go".
 *
 * Once stripped, a header is not restored even if a later hop re-enters the
 * scope: the request has already been observed by an out-of-scope party.
 * @param params - Header names to drop and the scope predicate.
 * @returns A hook to assign to the request options' `beforeRedirect`.
 * @example
 * const request = {
 *   beforeRedirect: createStripHeadersOnRedirect({
 *     headerNames: ['Authorization'],
 *     isInScope: (href) => href.startsWith('https://example.com/'),
 *   }),
 * };
 */
export function createStripHeadersOnRedirect(
	params: CreateStripHeadersOnRedirectParams,
): (options: RedirectHopOptions) => void {
	const lowerNames = new Set(params.headerNames.map((name) => name.toLowerCase()));
	return (options) => {
		const headers = options.headers;
		// Node types `headers` as possibly a raw `string[]`; follow-redirects
		// always hands over the object form this crawler built.
		if (!headers || Array.isArray(headers)) {
			return;
		}
		const href = resolveHopHref(options);
		if (href !== null && params.isInScope(href)) {
			return;
		}
		const record = headers as Record<string, unknown>;
		for (const key of Object.keys(record)) {
			if (lowerNames.has(key.toLowerCase())) {
				delete record[key];
			}
		}
	};
}

/**
 * Reconstructs the absolute URL of a redirect hop. An unresolvable hop yields
 * `null`, which the caller treats as out of scope (fail closed).
 * @param options - The per-hop options `follow-redirects` passes in.
 * @returns The absolute URL, or `null` when it cannot be determined.
 */
function resolveHopHref(options: RedirectHopOptions): string | null {
	if (options.href) {
		return options.href;
	}
	if (!options.protocol || !options.hostname) {
		return null;
	}
	const port = options.port ? `:${options.port}` : '';
	// An IPv6 literal arrives unbracketed (`::1`); without brackets the rebuilt
	// URL is unparseable and an in-scope hop would be judged external.
	const host = options.hostname.includes(':')
		? `[${options.hostname}]`
		: options.hostname;
	return `${options.protocol}//${host}${port}${options.path ?? '/'}`;
}
