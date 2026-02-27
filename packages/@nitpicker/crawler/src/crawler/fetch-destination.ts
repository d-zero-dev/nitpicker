import type { PageData } from '@d-zero/beholder';
import type { ExURL } from '@d-zero/shared/parse-url';
import type { FollowResponse, RedirectableRequest } from 'follow-redirects';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';

import { delay } from '@d-zero/shared/delay';
import redirects from 'follow-redirects';

import { destinationCache } from './destination-cache.js';
import NetTimeoutError from './net-timeout-error.js';

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
}

/**
 * Fetches the destination metadata for a URL using an HTTP HEAD request (or GET as fallback).
 *
 * Results are cached in memory so that repeated calls for the same URL
 * (without hash) return immediately. The request races against a 10-second
 * timeout; if the server does not respond in time, a {@link NetTimeoutError} is thrown.
 *
 * If the server returns 405 (Method Not Allowed), 501 (Not Implemented), or 503
 * (Service Unavailable) for a HEAD request, the function automatically retries with GET.
 * @param params - Parameters containing URL, external flag, method, options, and optional User-Agent.
 * @returns The page metadata obtained from the HTTP response.
 * @throws {NetTimeoutError} If the request exceeds the 10-second timeout.
 * @throws {Error} If the HTTP request fails for any other reason.
 */
export async function fetchDestination(
	params: FetchDestinationParams,
): Promise<PageData> {
	const { url, isExternal, method = 'HEAD', options, userAgent } = params;
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

	const result = await Promise.race([
		_fetchHead(url, isExternal, effectiveMethod, titleBytesLimit, userAgent).catch(
			(error: unknown) => (error instanceof Error ? error : new Error(String(error))),
		),
		(async () => {
			await delay(10 * 1000);
			return new NetTimeoutError(url.href);
		})(),
	]);

	destinationCache.set(cacheKey, result);
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
 * @returns A promise resolving to {@link PageData} with response metadata.
 */
async function _fetchHead(
	url: ExURL,
	isExternal: boolean,
	method: string,
	titleBytesLimit?: number,
	userAgent?: string,
) {
	return new Promise<PageData>((resolve, reject) => {
		const hostHeader = url.port ? `${url.hostname}:${url.port}` : url.hostname;
		const request: RequestOptions = {
			protocol: url.protocol,
			hostname: url.hostname,
			port: url.port || undefined,
			path: url.pathname,
			method,
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
				const redirectPaths = res.redirects.map((r) => r.url);
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
					meta: { title },
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
							reject(new Error(`Method Not Allowed: ${url.href} ${rep.statusText}`));
							return;
						}
						try {
							rep = await fetchDestination({ url, isExternal, method: 'GET' });
						} catch (error) {
							reject(error);
							return;
						}
					}

					if (rep.status === 501) {
						if (method === 'GET') {
							reject(new Error(`Method Not Implemented: ${url.href} ${rep.statusText}`));
							return;
						}
						await delay(5 * 1000);
						try {
							rep = await fetchDestination({ url, isExternal, method: 'GET' });
						} catch (error) {
							reject(error);
							return;
						}
					}

					if (rep.status === 503) {
						if (method === 'GET') {
							reject(new Error(`Retrying failed: ${url.href} ${rep.statusText}`));
							return;
						}
						await delay(5 * 1000);
						try {
							rep = await fetchDestination({ url, isExternal, method: 'GET' });
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
