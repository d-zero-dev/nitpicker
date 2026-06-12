import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { findMismatches } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/** Valid `type` values for the mismatches route. */
const VALID_MISMATCH_TYPES = ['canonical', 'og:title', 'og:description'] as const;

/**
 * Registers `GET /api/mismatches?type=canonical|og:title|og:description` — metadata mismatches.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerMismatchesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/mismatches', async (c) => {
		const type = c.req.query('type');
		if (!type || !(VALID_MISMATCH_TYPES as readonly string[]).includes(type)) {
			return c.json(
				{
					error: `Invalid or missing type. Must be one of: ${VALID_MISMATCH_TYPES.join(', ')}`,
				},
				400,
			);
		}
		const accessor = context.manager.get(context.archiveId);
		const result = await findMismatches(
			accessor,
			type as (typeof VALID_MISMATCH_TYPES)[number],
			toNumber(c.req.query('limit')),
			toNumber(c.req.query('offset')),
		);
		return c.json(result);
	});
}
