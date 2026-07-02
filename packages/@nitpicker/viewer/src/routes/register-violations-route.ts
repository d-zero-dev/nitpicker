import type { ArchiveContext } from '../types.js';
import type { GetViolationsOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { getViolations } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/violations` — analysis rule violations (axe/markuplint/etc.).
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerViolationsRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/violations', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);
		const options: GetViolationsOptions = {
			validator: q.validator,
			severity: q.severity,
			rule: q.rule,
			urlPattern: q.urlPattern,
			sortBy: q.sortBy as GetViolationsOptions['sortBy'],
			sortOrder: q.sortOrder as GetViolationsOptions['sortOrder'],
			limit: toNumber(q.limit),
			offset: toNumber(q.offset),
		};
		return c.json(await getViolations(accessor, options));
	});
}
