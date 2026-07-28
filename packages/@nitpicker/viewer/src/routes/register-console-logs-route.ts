import type { ArchiveContext } from '../types.js';
import type { ListConsoleLogsOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { listConsoleLogs } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/console-logs` — distinct console messages / page
 * errors, aggregated across every page they occurred on (issue #228).
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerConsoleLogsRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/console-logs', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);
		const options: ListConsoleLogsOptions = {
			type: q.type,
			sortBy: q.sortBy as ListConsoleLogsOptions['sortBy'],
			sortOrder: q.sortOrder as ListConsoleLogsOptions['sortOrder'],
			limit: toNumber(q.limit),
			offset: toNumber(q.offset),
		};
		return c.json(await listConsoleLogs(accessor, options));
	});
}
