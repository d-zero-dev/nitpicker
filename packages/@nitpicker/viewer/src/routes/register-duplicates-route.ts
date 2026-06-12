import type { ArchiveContext } from '../types.js';
import type { DuplicateEntry } from '@nitpicker/query';
import type { Hono } from 'hono';

import { findDuplicates } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/** Valid `field` values for the duplicates route. */
const VALID_DUPLICATE_FIELDS = ['title', 'description'] as const;

/**
 * Registers `GET /api/duplicates?field=title|description` — duplicate metadata.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerDuplicatesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/duplicates', async (c) => {
		const field = c.req.query('field');
		if (
			field !== undefined &&
			!(VALID_DUPLICATE_FIELDS as readonly string[]).includes(field)
		) {
			return c.json(
				{ error: `Invalid field. Must be one of: ${VALID_DUPLICATE_FIELDS.join(', ')}` },
				400,
			);
		}
		const accessor = context.manager.get(context.archiveId);
		const result = await findDuplicates(
			accessor,
			field as DuplicateEntry['field'] | undefined,
			toNumber(c.req.query('limit')),
		);
		return c.json(result);
	});
}
