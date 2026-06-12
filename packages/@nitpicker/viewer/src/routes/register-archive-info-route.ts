import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

/**
 * Registers `GET /api/info` — metadata about the opened archive.
 *
 * Carries the source `mode` and, for stub sources, a snapshot of the
 * crawler-side lock holder captured at viewer startup. The footer uses
 * the holder field to distinguish "Live crawl in progress" from
 * "Interrupted crawl stub" so the badge doesn't lie about an
 * already-dead crawler.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerArchiveInfoRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/info', (c) =>
		c.json({
			filePath: context.filePath,
			mode: context.mode,
			crawlerPid: context.crawlerLockHolder?.alive ? context.crawlerLockHolder.pid : null,
		}),
	);
}
