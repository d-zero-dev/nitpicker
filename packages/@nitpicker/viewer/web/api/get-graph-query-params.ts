/**
 * Extracts the `/api/graph` query parameters that {@link useGraph} forwards
 * from the current URL.
 *
 * Pulled out of the React hook so the URL → params contract can be tested
 * without booting a `<MemoryRouter>` + `QueryClientProvider` harness (the
 * viewer/web package deliberately has no React-hook testing infra — every
 * other hook in this tree follows the same "extract a pure helper, test the
 * helper" pattern).
 *
 * An absent `?limit=` becomes `undefined` so `apiGet`'s params serializer
 * skips it entirely and the server's default cap applies. Any value present
 * is passed through as a string (including `"0"`, which the API interprets
 * as "no cap").
 * @param searchParams - The current URL's `URLSearchParams`, as returned by
 *   `react-router`'s `useSearchParams`.
 * @returns Params object suitable for `apiGet('/api/graph', ...)`.
 */
export function getGraphQueryParams(searchParams: URLSearchParams): {
	limit: string | undefined;
} {
	return { limit: searchParams.get('limit') ?? undefined };
}
