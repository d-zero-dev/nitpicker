import type { TechnologySignalPartial } from '../archive/meta/technologies/types.js';
import type { FollowResponse, RedirectableRequest } from 'follow-redirects';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';

import redirects from 'follow-redirects';

import { TECHNOLOGY_SIGNAL_DEFINITIONS } from '../archive/meta/technologies/technology-signal-definitions.js';

/** Default cap on bytes read from a JS resource before giving up on a match. */
const DEFAULT_BYTE_LIMIT = 8192;
/** Default network timeout, shorter than `fetchDestination`'s HEAD budget — this is a best-effort enrichment pass, not the crawl's critical path. */
const DEFAULT_TIMEOUT_MS = 8000;
const EVIDENCE_MAX_LENGTH = 200;

/** Definitions this scan tests against — only the `js-license-comment` signal type applies to JS resource bodies (the rest match HTML). */
const JS_LICENSE_COMMENT_DEFINITIONS = TECHNOLOGY_SIGNAL_DEFINITIONS.filter(
	(def) => def.signalType === 'js-license-comment',
);

/** Options for {@link scanJsResourceForLicenseComment}. */
export interface ScanJsResourceForLicenseCommentOptions {
	/** Byte cap on the response body read. Defaults to {@link DEFAULT_BYTE_LIMIT}. */
	byteLimit?: number;
	/** Network timeout in milliseconds. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
	timeout?: number;
	/** User-Agent header to send. */
	userAgent?: string;
}

/**
 * Reads up to `byteLimit` bytes from a JS resource's leading bytes and tests
 * them against {@link TECHNOLOGY_SIGNAL_DEFINITIONS}' `js-license-comment`
 * patterns (e.g. Vue's leading license-banner comment). Best-effort: any network
 * failure, timeout, or non-2xx response resolves `null` rather than
 * throwing — a single unreachable JS resource must not abort the enrichment
 * pass over the rest of the archive's resources (see
 * `scanJsResourcesForTechnologySignals`, this function's only caller).
 *
 * Not cached and not routed through `destinationCache` (unlike
 * `fetchDestination`): callers are expected to persist the outcome in
 * `technology_js_scan_cache`, keyed by `resourceId`, so a resource is never
 * scanned twice across the archive's lifetime.
 * @param url - The JS resource's absolute URL.
 * @param options - Byte cap, timeout, and User-Agent overrides.
 * @returns The first matching signal, or `null` when nothing matched (or
 *   the fetch failed).
 * @example
 * const signal = await scanJsResourceForLicenseComment('https://example.com/_astro/app.js');
 * // { technology: 'Vue', signalType: 'js-license-comment', evidence: 'Vue.js license banner text', weight: 55, category: 'JavaScript frameworks' }
 */
export async function scanJsResourceForLicenseComment(
	url: string,
	options: ScanJsResourceForLicenseCommentOptions = {},
): Promise<TechnologySignalPartial | null> {
	const byteLimit = options.byteLimit ?? DEFAULT_BYTE_LIMIT;
	const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
	const body = await readLeadingBytes(url, byteLimit, timeout, options.userAgent).catch(
		() => null,
	);
	if (body == null) return null;

	for (const def of JS_LICENSE_COMMENT_DEFINITIONS) {
		const match = def.pattern.exec(body);
		if (match) {
			return {
				technology: def.technology,
				signalType: def.signalType,
				evidence: match[0].slice(0, EVIDENCE_MAX_LENGTH),
				weight: def.weight,
				category: def.category ?? null,
			};
		}
	}
	return null;
}

/**
 * Streams up to `byteLimit` bytes of a GET response body, destroying the
 * connection once the cap is reached (or the stream ends first). Mirrors
 * `fetchDestination`'s `titleBytesLimit` byte-cap technique (same
 * `follow-redirects` + manual chunk accumulation + `req.destroy()` shape),
 * but generic over "leading bytes as text" rather than title extraction —
 * this module has no `PageData` to build.
 * @param url - The absolute URL to fetch.
 * @param byteLimit - Byte cap on the accumulated body.
 * @param timeout - Milliseconds before the request is aborted.
 * @param userAgent - Optional User-Agent header.
 * @returns The accumulated body text, or `null` on a non-2xx response.
 */
async function readLeadingBytes(
	url: string,
	byteLimit: number,
	timeout: number,
	userAgent?: string,
): Promise<string | null> {
	return new Promise<string | null>((resolve, reject) => {
		const parsed = new URL(url);
		const request: RequestOptions & { trackRedirects: boolean } = {
			protocol: parsed.protocol,
			hostname: parsed.hostname,
			port: parsed.port || undefined,
			path: `${parsed.pathname}${parsed.search}`,
			method: 'GET',
			trackRedirects: true,
			headers: {
				host: parsed.host,
				...(userAgent ? { 'User-Agent': userAgent } : {}),
				Accept: '*/*',
				'Accept-Encoding': 'identity',
			},
		};

		let req: RedirectableRequest<ClientRequest, IncomingMessage>;
		let destroyed = false;
		let settled = false;

		const timeoutHandle = setTimeout(() => {
			if (settled) return;
			settled = true;
			destroyed = true;
			req.destroy();
			resolve(null);
		}, timeout);

		const response = (res: IncomingMessage & FollowResponse) => {
			const status = res.statusCode ?? 0;
			if (status < 200 || status >= 300) {
				settled = true;
				clearTimeout(timeoutHandle);
				destroyed = true;
				req.destroy();
				resolve(null);
				return;
			}

			const chunks: Buffer[] = [];
			let totalBytes = 0;

			res.on('data', (chunk: Buffer) => {
				if (settled) return;
				chunks.push(chunk);
				totalBytes += chunk.length;
				if (totalBytes >= byteLimit) {
					settled = true;
					clearTimeout(timeoutHandle);
					destroyed = true;
					req.destroy();
					resolve(Buffer.concat(chunks).toString('utf8'));
				}
			});
			res.on('end', () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutHandle);
				resolve(Buffer.concat(chunks).toString('utf8'));
			});
		};

		if (parsed.protocol === 'https:') {
			req = redirects.https.request(request, response);
		} else {
			req = redirects.http.request(request, response);
		}
		req.on('error', (error) => {
			clearTimeout(timeoutHandle);
			// Ignore errors caused by our own intentional req.destroy() above.
			if (destroyed) return;
			reject(error);
		});
		req.end();
	});
}
