import type { ExURL } from '@d-zero/shared/parse-url';

import { crawlerLog } from '../debug.js';

import { fetchRobotsTxt } from './fetch-robots-txt.js';

/**
 * Derives the origin string from an ExURL (e.g., `https://example.com:8080`).
 * @param url - The extended URL.
 * @returns The origin string.
 */
function getOrigin(url: ExURL): string {
	return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
}

/**
 * Checks whether a URL is allowed by the site's robots.txt rules.
 *
 * Caches robots.txt per origin so each origin is fetched at most once.
 * When disabled (i.e., `ignoreRobots` mode), all URLs are allowed.
 */
export class RobotsChecker {
	/** Cache of parsed robots.txt per origin. `null` means no robots.txt or fetch failed. */
	readonly #cache = new Map<string, Awaited<ReturnType<typeof fetchRobotsTxt>>>();
	/** When `false`, robots.txt checking is disabled and all URLs are allowed. */
	readonly #enabled: boolean;
	/** User-Agent string used for robots.txt rule matching and HTTP requests. */
	readonly #userAgent: string;

	/**
	 * Create a new RobotsChecker.
	 * @param userAgent - User-Agent string for rule matching and fetching robots.txt.
	 * @param enabled - Whether robots.txt checking is enabled. When `false`, {@link isAllowed} always returns `true`.
	 */
	constructor(userAgent: string, enabled: boolean) {
		this.#userAgent = userAgent;
		this.#enabled = enabled;
	}

	/**
	 * Check whether the given URL is allowed by the site's robots.txt.
	 *
	 * Fetches and caches robots.txt per origin on first access.
	 * Returns `true` if robots.txt checking is disabled, if no robots.txt
	 * exists, or if the URL is explicitly allowed.
	 * @param url - The URL to check.
	 * @returns `true` if the URL is allowed, `false` if blocked.
	 */
	async isAllowed(url: ExURL): Promise<boolean> {
		if (!this.#enabled) {
			return true;
		}

		if (!url.isHTTP) {
			return true;
		}

		const origin = getOrigin(url);
		if (!this.#cache.has(origin)) {
			crawlerLog('Fetching robots.txt for %s', origin);
			const robot = await fetchRobotsTxt(origin, this.#userAgent);
			this.#cache.set(origin, robot);
		}

		const robot = this.#cache.get(origin);
		if (!robot) {
			return true;
		}

		const allowed = robot.isAllowed(url.href, this.#userAgent);
		return allowed !== false;
	}
}
