/** A query-parameter value accepted by {@link apiGet}. */
type ParamValue = string | number | boolean | undefined;

/**
 * Performs a typed GET request against the viewer's REST API.
 *
 * Resolves relative to the current origin (same-origin in production; proxied
 * to the backend by Vite in development). Throws on non-2xx responses, using
 * the server's sanitized `error` field as the message when available.
 * @param path - The API path (e.g. `/api/pages`).
 * @param params - Optional query parameters; `undefined` values are omitted.
 * @returns The parsed JSON response.
 * @throws {Error} If the response status is not OK.
 */
export async function apiGet<T>(
	path: string,
	params?: Record<string, ParamValue>,
): Promise<T> {
	const url = new URL(path, globalThis.location.origin);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) {
				url.searchParams.set(key, String(value));
			}
		}
	}
	const response = await fetch(url);
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Request failed with status ${response.status}`);
	}
	return (await response.json()) as T;
}
