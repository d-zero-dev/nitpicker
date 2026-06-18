import type { PageData } from '@d-zero/beholder';
import type { ExURL } from '@d-zero/shared/parse-url';
import type { FollowResponse, RedirectableRequest } from 'follow-redirects';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';

import { delay } from '@d-zero/shared/delay';
import redirects from 'follow-redirects';

import { classifyErrorKind } from '../classify-error-kind.js';

import { destinationCache } from './destination-cache.js';
import NetTimeoutError from './net-timeout-error.js';

/**
 * Return true when an HTTP HEAD attempt failed in a way that warrants a GET
 * retry on the same URL.
 *
 * The existing `_fetchHead` already covers the "HEAD returned a status that
 * proves the method isn't accepted" case (405 / 501 / 503). This helper
 * picks up the *other* shape of HEAD rejection: the server returned no
 * status at all because a WAF / middlebox silently dropped or mangled the
 * HEAD request. Government / corporate sites with strict bot defences do
 * this — they answer GET fine in a real browser but ignore HEAD entirely.
 *
 * Only error kinds that genuinely describe "HEAD reached the server but the
 * server (or its middlebox) refused to respond cleanly" qualify:
 *
 * - `NetTimeoutError` — race timeout, no answer in budget
 * - `'parse-error'` — server returned bytes but they're not parseable HTTP
 *   (proxy garbage / WAF rewrite)
 * - `'connection-reset'` — TCP reset mid-response
 *
 * Errors that prove "the request couldn't reach the server at all" (DNS,
 * connection-refused / -timeout, TLS, local-network) are excluded — a GET
 * retry there would just pay the same network cost for the same answer.
 * @param error - The Error that the HEAD attempt rejected with.
 * @returns Whether a GET fallback should be attempted.
 */
function shouldGetFallbackOnHeadFailure(error: Error): boolean {
	if (error instanceof NetTimeoutError) {
		return true;
	}
	const kind = classifyErrorKind(error.message);
	return kind === 'parse-error' || kind === 'connection-reset';
}

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
	 * Race timeout for the network request in milliseconds. Defaults to
	 * {@link DEFAULT_HEAD_TIMEOUT_MS} (10s). `Crawler.#sendHeadRequest` passes
	 * a longer value on later retry attempts so a slow-but-reachable server
	 * gets another chance before being given up on.
	 */
	readonly timeout?: number;
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
	const { url, isExternal, method = 'HEAD', options, userAgent, timeout } = params;
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

	// Race the fetch against the requested timeout. The losing timer is cleared
	// explicitly so it never keeps the event loop alive after the race settles
	// (a plain `delay()` in `Promise.race` would leak the timer until it fires).
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const result = await Promise.race([
		_fetchHead(
			url,
			isExternal,
			effectiveMethod,
			titleBytesLimit,
			userAgent,
			timeout,
		).catch((error: unknown) =>
			error instanceof Error ? error : new Error(String(error)),
		),
		new Promise<NetTimeoutError>((resolve) => {
			timeoutHandle = setTimeout(
				() => resolve(new NetTimeoutError(url.href)),
				raceTimeoutMs,
			);
		}),
	]).finally(() => {
		if (timeoutHandle) clearTimeout(timeoutHandle);
	});

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

	// NetTimeoutError is intentionally NOT cached: the caller may retry the
	// same URL with a longer timeout (see Crawler.#sendHeadRequest's
	// HEAD_TIMEOUT_ESCALATION_MS), and a cache hit here would re-throw the
	// stale 10s timeout instead of letting the 30s/60s retry actually run.
	// Other errors (DNS / TLS / refused / parse) are persistent within a
	// crawl session so caching them is what keeps a doomed host from
	// re-paying the network cost N times.
	if (!(result instanceof NetTimeoutError)) {
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
 * @param url - The extended URL to request.
 * @param isExternal - Whether the URL is external to the crawl scope.
 * @param method - The HTTP method (`"HEAD"` or `"GET"`).
 * @param titleBytesLimit - When set, reads up to this many bytes from the response body
 *   to extract a `<title>` tag, then destroys the connection.
 * @param userAgent - Optional User-Agent string to send with the request.
 * @param timeout - Optional race timeout in ms, forwarded to GET fallback so the
 *   second pass keeps the same budget as the original HEAD attempt.
 * @returns A promise resolving to {@link PageData} with response metadata.
 */
async function _fetchHead(
	url: ExURL,
	isExternal: boolean,
	method: string,
	titleBytesLimit?: number,
	userAgent?: string,
	timeout?: number,
) {
	return new Promise<PageData>((resolve, reject) => {
		const hostHeader = url.port ? `${url.hostname}:${url.port}` : url.hostname;
		// `trackRedirects` makes follow-redirects populate `res.redirects` with the
		// chain of followed URLs. Without it that array stays empty and the
		// pre-flight cannot tell where a URL lands — required for the redirect
		// chain in `redirectPaths` and for the #73 convergence dedup, which decides
		// whether a redirect destination was already rendered *before* launching
		// the browser.
		const request: RequestOptions & { trackRedirects: boolean } = {
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

		if (url.username && url.password) {
			request.auth = `${url.username}:${url.password}`;
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
