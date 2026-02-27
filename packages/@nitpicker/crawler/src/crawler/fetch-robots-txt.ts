import type { FollowResponse } from 'follow-redirects';
import type { IncomingMessage } from 'node:http';

import { createRequire } from 'node:module';

import redirects from 'follow-redirects';

/**
 * Result of parsing a robots.txt file.
 */
interface RobotsResult {
	/**
	 * Check if a URL is allowed for a given user-agent.
	 * @param url - The URL to check.
	 * @param ua - The user-agent string to match against.
	 * @returns `true` if allowed, `false` if disallowed, `undefined` if no matching rule.
	 */
	isAllowed(url: string, ua?: string): boolean | undefined;
	/**
	 * Check if a URL is disallowed for a given user-agent.
	 * @param url - The URL to check.
	 * @param ua - The user-agent string to match against.
	 * @returns `true` if disallowed, `false` if allowed, `undefined` if no matching rule.
	 */
	isDisallowed(url: string, ua?: string): boolean | undefined;
	/**
	 * Get the crawl delay for a given user-agent.
	 * @param ua - The user-agent string to match against.
	 * @returns The crawl delay in seconds, or `undefined` if not specified.
	 */
	getCrawlDelay(ua?: string): number | undefined;
	/**
	 * Get the sitemaps listed in robots.txt.
	 * @returns An array of sitemap URLs.
	 */
	getSitemaps(): string[];
}

const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as (
	url: string,
	robotstxt: string,
) => RobotsResult;

/**
 * Fetches and parses the robots.txt file for a given origin URL.
 *
 * Sends an HTTP(S) GET request to `{origin}/robots.txt` and parses the
 * response using `robots-parser`. Returns `null` if the server returns
 * a non-200 status code or if the request fails.
 * @param origin - The origin URL (e.g., `https://example.com`).
 * @param userAgent - Optional User-Agent string to send with the request.
 * @returns A parsed RobotsResult instance, or `null` if robots.txt is unavailable.
 */
export async function fetchRobotsTxt(
	origin: string,
	userAgent?: string,
): Promise<RobotsResult | null> {
	const robotsUrl = `${origin}/robots.txt`;
	return new Promise((resolve) => {
		const protocol = robotsUrl.startsWith('https') ? redirects.https : redirects.http;
		const req = protocol.get(
			robotsUrl,
			{
				headers: {
					...(userAgent ? { 'User-Agent': userAgent } : {}),
				},
				timeout: 10_000,
			},
			(res: IncomingMessage & FollowResponse) => {
				if (res.statusCode !== 200) {
					res.resume();
					resolve(null);
					return;
				}
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => {
					const body = Buffer.concat(chunks).toString('utf8');
					resolve(robotsParser(robotsUrl, body));
				});
				res.on('error', () => resolve(null));
			},
		);
		req.on('error', () => resolve(null));
		req.on('timeout', () => {
			req.destroy();
			resolve(null);
		});
	});
}
