/**
 * A query-parameter value accepted by {@link apiGet}. An array serializes as
 * a repeated key (`?status=200&status=404`) — the same shape a multi-select
 * checkbox filter's server-side `c.req.queries(key)` reads back — instead of
 * a single joined value. Array elements may be numbers (e.g. a `status`
 * filter's values) alongside strings.
 */
type ParamValue = string | number | boolean | readonly (string | number)[] | undefined;

/**
 * Performs a typed GET request against the viewer's REST API.
 *
 * Resolves relative to the current origin (same-origin in production; proxied
 * to the backend by Vite in development). Throws on non-2xx responses, using
 * the server's sanitized `error` field as the message when available.
 *
 * Also throws on a `ReadModelUnavailable` payload (`{ available: false,
 * reason: 'read-model-required' }` — see `shouldRefuseStaleReadModel` on the
 * server side): every list view surfaces the thrown message through its
 * existing `DataTable` error banner, so no per-view unavailable-state
 * handling is needed. Discriminated on `reason`, NOT on `available` alone —
 * `/api/pages/inbound-links`' stub-mode `{ available: false }` (no `reason`)
 * is legitimate data its consumer branches on, and must pass through.
 * @param path - The API path (e.g. `/api/pages`).
 * @param params - Optional query parameters; `undefined` values are omitted.
 *   An array value is appended once per element (empty arrays omit the key
 *   entirely, matching "no filter" rather than "match nothing").
 * @returns The parsed JSON response.
 * @throws {Error} If the response status is not OK, or the server refused
 *   the request pending a `viewer-build` run.
 */
export async function apiGet<T>(
	path: string,
	params?: Record<string, ParamValue>,
): Promise<T> {
	const url = new URL(path, globalThis.location.origin);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined) continue;
			if (Array.isArray(value)) {
				for (const item of value) {
					url.searchParams.append(key, String(item));
				}
				continue;
			}
			url.searchParams.set(key, String(value));
		}
	}
	const response = await fetch(url);
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Request failed with status ${response.status}`);
	}
	const payload = (await response.json()) as T;
	if (
		typeof payload === 'object' &&
		payload !== null &&
		(payload as { available?: unknown; reason?: unknown }).available === false &&
		(payload as { reason?: unknown }).reason === 'read-model-required'
	) {
		throw new Error(
			"This view requires the archive's viewer read model, which is missing or stale. " +
				'Run `nitpicker viewer-build <archive>` once, then restart the viewer. ' +
				'このビューにはviewer read modelが必要です。`nitpicker viewer-build <archive>` を実行してからviewerを再起動してください。',
		);
	}
	return payload;
}
