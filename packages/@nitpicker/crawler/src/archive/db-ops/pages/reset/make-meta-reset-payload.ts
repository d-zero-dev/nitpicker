import { META_NULLABLE_COLUMNS } from './meta-nullable-columns.js';

/**
 * Builds the reset payload for {@link ./meta-nullable-columns.ts} as a plain object
 * suitable for `knex.update(...)`. All listed columns are mapped to `null`.
 */
export function makeMetaResetPayload(): Record<string, null> {
	const payload: Record<string, null> = {};
	for (const col of META_NULLABLE_COLUMNS) {
		payload[col] = null;
	}
	return payload;
}
