import type { PageData } from '@d-zero/beholder';
import type { ExURL } from '@d-zero/shared/parse-url';
import type {
	FollowOptions,
	FollowResponse,
	RedirectableRequest,
} from 'follow-redirects';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';

import { delay } from '@d-zero/shared/delay';
import { raceWithTimeout } from '@d-zero/shared/race-with-timeout';
import redirects from 'follow-redirects';

import { createStripHeadersOnRedirect } from './create-strip-headers-on-redirect.js';
import { decodeAuthCredential } from './decode-auth-credential.js';
import { destinationCache } from './destination-cache.js';
import NetTimeoutError from './net-timeout-error.js';
import { shouldGetFallbackOnHeadFailure } from './should-get-fallback-on-head-failure.js';

/** Default race timeout for the HEAD pre-flight, in milliseconds. */
const DEFAULT_HEAD_TIMEOUT_MS = 10 * 1000;

/**
 * Parameters for {@link fetchDestination}.
 */
export interface FetchDestinationParams {
	/** The extended URL to fetch. */
	readonly url: ExURL;
	/** Whether the URL is external to the crawl scope. */
	readonly isExternal: boolean;
	/** The HTTP method to use. Defaults to `"HEAD"`. */
	readonly method?: string;
	/** Additional options. */
	readonly options?: {
		/**
		 * When set, forces a GET request and reads up to this many bytes from
		 * the response body to extract an HTML `<title>` tag.
		 */
		titleBytesLimit?: number;
	};
	/** User-Agent string to send with the request. */
	readonly userAgent?: string;
	/**
	 * Extra request headers (`--header` / `--authorization`) to send. Applied
	 * only when the URL is in scope (`isExternal === false`) and dropped again
	 * if a redirect leaves the scope (see `isInScope`). A header named
	 * `Authorization` wins over the Basic credentials embedded in the URL,
	 * because Node ignores `auth` when an `Authorization` header is present.
	 */
	readonly requestHeaders?: Readonly<Record<string, string>>;
	/**
	 * Whether a redirect target (absolute URL) is inside the crawl scope.
	 * Required for `requestHeaders` to survive any redirect safely: when it is
	 * omitted, `requestHeaders` are stripped on every redirect hop (fail closed).
	 */
	readonly isInScope?: (href: string) => boolean;
	/**
	 * Race timeout for the network request in milliseconds. Defaults to
	 * {@link DEFAULT_HEAD_TIMEOUT_MS} (10s). `Crawler.#sendHeadRequest` passes
	 * a longer value on later retry attempts so a slow-but-reachable server
	 * gets another chance before being given up on.
	 */
	readonly timeout?: number;
}

/**
 * Parameters for the internal single-request helper: the shared request
 * parameters of {@link FetchDestinationParams}, with the already-resolved
 * method and title limit.
 */
interface FetchHeadParams extends Pick<
	FetchDestinationParams,
	'url' | 'isExternal' | 'userAgent' | 'requestHeaders' | 'isInScope' | 'timeout'
> {
	/** The HTTP method (`"HEAD"` or `"GET"`). */
	readonly method: string;
	/** Reads up to this many body bytes to extract `<title>`; `undefined` for a metadata-only request. */
	readonly titleBytesLimit?: number;
}

/**
 * Fetches the destination metadata for a URL using an HTTP HEAD request (or GET as fallback).
 *
 * Results are cached in memory so that repeated calls for the same URL
 * (without hash) return immediately. The request races against a configurable
 * timeout (defaults to {@link DEFAULT_HEAD_TIMEOUT_MS}, 10 seconds); if the
 * server does not respond in time, a {@link NetTimeoutError} is thrown.
 *
 * If the server returns 405 (Method Not Allowed), 501 (Not Implemented), or 503
 * (Service Unavailable) for a HEAD request, the function automatically retries with GET.
 * @param params - Parameters containing URL, external flag, method, options, optional User-Agent, and optional timeout.
 * @returns The page metadata obtained from the HTTP response.
 * @throws {NetTimeoutError} If the request exceeds the configured timeout.
 * @throws {Error} If the HTTP request fails for any other reason.
 */
export async function fetchDestination(
	params: FetchDestinationParams,
): Promise<PageData> {
	const {
		url,
		isExternal,
		method = 'HEAD',
		options,
		userAgent,
		requestHeaders,
		isInScope,
		timeout,
	} = params;
	const titleBytesLimit = options?.titleBytesLimit;
	const cacheKey = titleBytesLimit == null ? url.withoutHash : `${url.withoutHash}:title`;

	if (destinationCache.has(cacheKey)) {
		const cache = destinationCache.get(cacheKey)!;
		if (cache instanceof Error) {
			throw cache;
		}
		return cache;
	}

	const effectiveMethod = titleBytesLimit == null ? method : 'GET';
	const raceTimeoutMs = timeout ?? DEFAULT_HEAD_TIMEOUT_MS;

	// Race the fetch against the requested timeout via `raceWithTimeout`, which
	// clears the losing timer internally so it never keeps the event loop
	// alive after the race settles.
	const { result: challengeResult, timeout: timedOut } = await raceWithTimeout(
		() =>
			_fetchHead({
				url,
				isExternal,
				method: effectiveMethod,
				titleBytesLimit,
				userAgent,
				requestHeaders,
				isInScope,
				timeout,
			}).catch((error: unknown) =>
				error instanceof Error ? error : new Error(String(error)),
			),
		raceTimeoutMs,
	);
	const result = timedOut ? new NetTimeoutError(url.href) : challengeResult;

	// HEAD failure fallback: a WAF / middlebox that silently drops HEAD will
	// surface as NetTimeoutError / parse-error / connection-reset here even
	// though the same URL serves a normal GET response. Try GET once (using
	// the same timeout budget) before giving up on the URL. Only when
	// `method === 'HEAD'` to avoid infinite recursion if the GET itself
	// times out — at that point the server really is unreachable.
	if (
		method === 'HEAD' &&
		result instanceof Error &&
		shouldGetFallbackOnHeadFailure(result)
	) {
		try {
			const getResult = await fetchDestination({
				url,
				isExternal,
				method: 'GET',
				userAgent,
				requestHeaders,
				isInScope,
				timeout,
			});
			// GET succeeded — that is the canonical answer for this URL, so
			// cache it under the HEAD cacheKey too (same key, since cacheKey
			// only depends on URL + titleBytesLimit, not on method). The
			// inner GET call already wrote to the cache under the same key,
			// but a future caller hitting the HEAD path will find it there.
			return getResult;
		} catch {
			// GET fallback failed too; fall through to surface the original
			// HEAD failure so retry / classification / DNS-burned cache see
			// the actual underlying cause.
		}
	}

	// Errors that are RECOVERABLE on retry — NetTimeoutError plus the kinds
	// `shouldGetFallbackOnHeadFailure` already singles out as
	// possibly-recoverable (parse-error, connection-reset) — are
	// intentionally NOT cached. Caching a recoverable failure would freeze
	// the first slow probe as the verdict for every later caller on the
	// same host AND defeat `Crawler.#sendHeadRequest`'s
	// HEAD_TIMEOUT_ESCALATION_MS (the 30s/60s retry would hit the cache and
	// re-throw the stale 10s failure instead of getting the longer
	// budget). DNS / TLS / refused / blocked are persistent within a crawl
	// session so caching them is what keeps a doomed host from re-paying
	// the network cost N times.
	const isRecoverableError =
		result instanceof Error && shouldGetFallbackOnHeadFailure(result);
	if (!isRecoverableError) {
		destinationCache.set(cacheKey, result);
	}
	if (result instanceof Error) {
		throw result;
	}

	return result;
}

/**
 * Performs the actual HTTP request to retrieve page metadata.
 *
 * Handles both HTTP and HTTPS protocols via `follow-redirects`, tracks redirect chains,
 * and falls back to GET on certain status codes (405, 501, 503).
 * @param params - Request parameters.
 * @param params.url - The extended URL to request.
 * @param params.isExternal - Whether the URL is external to the crawl scope.
 * @param params.method - The HTTP method (`"HEAD"` or `"GET"`).
 * @param params.titleBytesLimit - When set, reads up to this many bytes from the response body
 *   to extract a `<title>` tag, then destroys the connection.
 * @param params.userAgent - Optional User-Agent string to send with the request.
 * @param params.requestHeaders - Optional extra headers, sent only for in-scope URLs.
 * @param params.isInScope - Scope predicate used to drop `requestHeaders` on out-of-scope redirects.
 * @param params.timeout - Optional race timeout in ms, forwarded to GET fallback so the
 *   second pass keeps the same budget as the original HEAD attempt.
 * @returns A promise resolving to {@link PageData} with response metadata.
 */
async function _fetchHead(params: FetchHeadParams) {
	const {
		url,
		isExternal,
		method,
		titleBytesLimit,
		userAgent,
		requestHeaders,
		isInScope,
		timeout,
	} = params;
	return new Promise<PageData>((resolve, reject) => {
		const hostHeader = url.port ? `${url.hostname}:${url.port}` : url.hostname;
		// `trackRedirects` makes follow-redirects populate `res.redirects` with the
		// chain of followed URLs. Without it that array stays empty and the
		// pre-flight cannot tell where a URL lands — required for the redirect
		// chain in `redirectPaths` and for the #73 convergence dedup, which decides
		// whether a redirect destination was already rendered *before* launching
		// the browser.
		const request: RequestOptions &
			FollowOptions<RequestOptions> & { trackRedirects: boolean } = {
			protocol: url.protocol,
			hostname: url.hostname,
			port: url.port || undefined,
			path: url.pathname,
			method,
			trackRedirects: true,
			headers: {
				host: hostHeader,
				...(userAgent ? { 'User-Agent': userAgent } : {}),
				Connection: 'keep-alive',
				Pragma: 'no-cache',
				'Cache-Control': 'no-cache',
				'Upgrade-Insecure-Requests': 1,
				Accept:
					'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
				'Accept-Encoding': 'gzip, deflate',
				'Accept-Language':
					'ja,en;q=0.9,zh;q=0.8,en-US;q=0.7,pl;q=0.6,de;q=0.5,zh-CN;q=0.4,zh-TW;q=0.3,th;q=0.2,ko;q=0.1,fr;q=0.1',
				// Range: url.extname?.toLowerCase() === 'pdf' ? 'bytes=0-0' : undefined,
			},
		};

		// `||`, not `&&`: ExURL rounds an empty userinfo component to null,
		// so `http://user:@host/` (legal empty-password Basic auth) has
		// `password: null`. Requiring both would leave this pre-flight
		// unauthenticated while the browser path (`page.authenticate`, which
		// always runs and treats null as '') succeeds — and for non-HTML
		// content the browser never runs, so the HEAD 401 would become the
		// page's final recorded status.
		if (url.username || url.password) {
			// ExURL fields are WHATWG percent-encoded; `auth` is base64'd
			// verbatim into the Authorization header, so decode first —
			// mirroring what Node's own `urlToOptions` does for
			// `http.request(url)` (see `decode-auth-credential.ts`).
			request.auth = `${decodeAuthCredential(url.username)}:${decodeAuthCredential(url.password)}`;
		}

		// Extra headers are a scope-bound credential: never sent to an external
		// URL, and dropped again if a redirect hop leaves the scope. Applied after
		// `request.auth` is set so the explicit `Authorization` header wins.
		const extraHeaderNames = requestHeaders ? Object.keys(requestHeaders) : [];
		if (!isExternal && requestHeaders && extraHeaderNames.length > 0) {
			// Case-insensitive replace: the base headers use fixed casings
			// (`Accept`, `User-Agent`), so a plain `Object.assign` of `accept`
			// would leave both keys and Node would send both.
			// The object literal above is always the plain-object form, never `string[]`.
			const baseHeaders = request.headers as Record<string, unknown>;
			const overridden = new Set(extraHeaderNames.map((name) => name.toLowerCase()));
			for (const key of Object.keys(baseHeaders)) {
				if (overridden.has(key.toLowerCase())) {
					delete baseHeaders[key];
				}
			}
			Object.assign(baseHeaders, requestHeaders);
			request.beforeRedirect = createStripHeadersOnRedirect({
				headerNames: extraHeaderNames,
				isInScope: isInScope ?? (() => false),
			});
		}

		let req: RedirectableRequest<ClientRequest, IncomingMessage>;
		let destroyed = false;
		const response = (res: IncomingMessage & FollowResponse) => {
			const chunks: Buffer[] = [];
			let totalBytes = 0;
			let settled = false;

			const buildPageData = (title: string): PageData => {
				// `res.redirects` (populated by trackRedirects) ALWAYS starts with the
				// originally requested URL, then each followed hop. We drop that first
				// entry so `redirectPaths` keeps its established contract: empty when the
				// URL did not redirect, and `[...intermediate, finalDest]` when it did
				// (the original URL is NOT included — callers like `resolveRedirectChain`
				// and `updatePage` re-add it). Keeping the original here would (a) make
				// `redirectPaths` non-empty for every page, so a direct page looks like a
				// self-redirect, and (b) leak the query-stripped request-target (the HEAD
				// request uses `url.pathname`), collapsing query-distinguished pages.
				// Redirect *targets* come from Location headers and keep their query.
				const redirectPaths = res.redirects.map((r) => r.url).slice(1);
				const _contentLength = Number.parseInt(res.headers['content-length'] || '');
				const contentLength = Number.isFinite(_contentLength) ? _contentLength : null;
				return {
					url,
					isTarget: !isExternal,
					isExternal,
					redirectPaths,
					status: res.statusCode || 0,
					statusText: res.statusMessage || '',
					contentType: res.headers['content-type']?.split(';')[0] || null,
					contentLength,
					responseHeaders: res.headers,
					// beholder 3.0.0 made jsonLd / speculationRules / tags /
					// others / originTrial required Meta fields. Even this
					// HEAD-only fallback path must populate every slot so
					// downstream insert/derive helpers iterate without crashing.
					meta: {
						title,
						jsonLd: [],
						speculationRules: [],
						tags: { detected: {}, entries: [] },
						others: {
							meta: {},
							property: {},
							httpEquiv: {},
							itemprop: {},
							link: [],
							script: [],
							iframe: [],
						},
						originTrial: [],
					},
					imageList: [],
					anchorList: [],
					html: '',
					mainContents: null,
					scrollHeight: null,
					imageScan: { desktop: null, mobile: null },
					isSkipped: false,
				};
			};

			if (titleBytesLimit == null) {
				res.on('data', () => {});
				res.on('end', async () => {
					let rep = buildPageData('');

					if (rep.status === 405) {
						if (method === 'GET') {
							// GET fallback also returned 405 — the server really does
							// reject both methods. Resolve with the PageData so the
							// archive records `status: 405` instead of the `-1`
							// sentinel a reject would land on (which would erase the
							// only useful diagnostic the server gave us).
							resolve(rep);
							return;
						}
						try {
							rep = await fetchDestination({
								url,
								isExternal,
								method: 'GET',
								userAgent,
								requestHeaders,
								isInScope,
								timeout,
							});
						} catch (error) {
							reject(error);
							return;
						}
					}

					if (rep.status === 501) {
						if (method === 'GET') {
							// GET fallback also returned 501 — preserve the status
							// rather than dropping it into the `-1` bucket.
							resolve(rep);
							return;
						}
						await delay(5 * 1000);
						try {
							rep = await fetchDestination({
								url,
								isExternal,
								method: 'GET',
								userAgent,
								requestHeaders,
								isInScope,
								timeout,
							});
						} catch (error) {
							reject(error);
							return;
						}
					}

					if (rep.status === 503) {
						if (method === 'GET') {
							// GET fallback also returned 503 — preserve the status.
							// A second-pass 5xx from a different method is the
							// server's real answer, not a transient HEAD-only quirk,
							// so the archive should remember it as 503 instead of
							// the generic `-1` sentinel.
							resolve(rep);
							return;
						}
						await delay(5 * 1000);
						try {
							rep = await fetchDestination({
								url,
								isExternal,
								method: 'GET',
								userAgent,
								requestHeaders,
								isInScope,
								timeout,
							});
						} catch (error) {
							reject(error);
							return;
						}
					}

					resolve(rep);
				});
			} else {
				res.on('data', (chunk: Buffer) => {
					if (settled) return;
					chunks.push(chunk);
					totalBytes += chunk.length;

					// Check for title in accumulated data so far
					const body = Buffer.concat(chunks).toString('utf8');
					const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
					if (titleMatch) {
						settled = true;
						const title = titleMatch[1]?.trim() ?? '';
						resolve(buildPageData(title));
						destroyed = true;
						req.destroy();
						return;
					}

					// Reached byte limit without finding title
					if (totalBytes >= titleBytesLimit) {
						settled = true;
						resolve(buildPageData(''));
						destroyed = true;
						req.destroy();
					}
				});
				res.on('end', () => {
					if (settled) return;
					settled = true;
					// Stream ended before limit — try to extract title from what we have
					const body = Buffer.concat(chunks).toString('utf8');
					const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
					const title = titleMatch?.[1]?.trim() ?? '';
					resolve(buildPageData(title));
				});
			}
		};
		if (url.protocol === 'https:') {
			req = redirects.https.request(request, response);
		} else {
			req = redirects.http.request(request, response);
		}
		req.on('error', (error) => {
			// Ignore errors caused by intentional req.destroy()
			if (destroyed) return;
			reject(error);
		});
		req.end();
	});
}
