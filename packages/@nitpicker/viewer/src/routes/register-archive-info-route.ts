import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

/**
 * Registers `GET /api/info` — metadata about the opened archive (its absolute
 * file path). Used by the footer to show which archive is being viewed.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerArchiveInfoRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/info', (c) => c.json({ filePath: context.filePath }));
}
