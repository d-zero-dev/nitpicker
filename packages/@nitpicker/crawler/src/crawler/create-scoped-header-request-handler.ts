import type { CreateScopedHeaderRequestHandlerParams } from './types.js';
import type { HTTPRequest } from 'puppeteer';

/**
 * Builds the Puppeteer `'request'` handler that attaches the user-supplied
 * extra headers to in-scope requests only. It is meant for a page that has
 * `setRequestInterception(true)`.
 *
 * WHY not `page.setExtraHTTPHeaders`: that applies to every request the page
 * issues — third-party sub-resources and external redirect targets included —
 * which would hand a bearer token to every CDN and analytics host the page
 * touches. Deciding per request URL keeps the credential inside the scope
 * (the same boundary `scope-auth-leak.e2e.ts` guards for Basic auth).
 *
 * Header names are matched case-insensitively. `request.headers()` returns
 * lower-case keys, so a naive object spread would send both `authorization`
 * (the page's own) and `Authorization` (the override) and the server would
 * see a comma-joined value.
 *
 * An out-of-scope request has the configured header names removed, not just
 * left unset: a redirect hop can inherit the headers an earlier in-scope hop
 * was continued with, and `request.headers()` then still carries them.
 *
 * Each request is explicitly continued: once interception is on, an
 * unhandled request hangs. A request another handler already resolved is left
 * alone. If `continue()` itself rejects (Chromium refusing a header), the
 * request is aborted rather than left hanging, and `onError` is told — an
 * unhandled rejection here would take the whole crawl down.
 * @param params - Headers to attach, the scope predicate and an optional error sink.
 * @returns The handler to register with `page.on('request', handler)`.
 * @example
 * await page.setRequestInterception(true);
 * page.on(
 *   'request',
 *   createScopedHeaderRequestHandler({
 *     requestHeaders: { Authorization: 'Bearer token' },
 *     isInScope: (href) => href.startsWith('https://example.com/'),
 *   }),
 * );
 */
export function createScopedHeaderRequestHandler(
	params: CreateScopedHeaderRequestHandlerParams,
): (request: HTTPRequest) => void {
	const lowerNames = new Set(
		Object.keys(params.requestHeaders).map((n) => n.toLowerCase()),
	);

	return (request) => {
		if (request.isInterceptResolutionHandled()) {
			return;
		}
		const headers = request.headers();
		const stripped = Object.fromEntries(
			Object.entries(headers).filter(([key]) => !lowerNames.has(key.toLowerCase())),
		);
		const inherited = Object.keys(stripped).length !== Object.keys(headers).length;

		let settled: Promise<void>;
		if (params.isInScope(request.url())) {
			settled = request.continue({ headers: { ...stripped, ...params.requestHeaders } });
		} else if (inherited) {
			settled = request.continue({ headers: stripped });
		} else {
			settled = request.continue();
		}

		settled.catch(async (error: unknown) => {
			params.onError?.(error);
			if (!request.isInterceptResolutionHandled()) {
				await request.abort('failed').catch(() => {});
			}
		});
	};
}
