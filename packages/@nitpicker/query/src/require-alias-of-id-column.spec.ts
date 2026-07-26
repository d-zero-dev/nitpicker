import { describe, it, expect } from 'vitest';

import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';

describe('requireAliasOfIdColumn', () => {
	it('resolves when content_items.alias_of_id exists', async () => {
		const knex = {
			schema: { hasColumn: () => Promise.resolve(true) },
		} as unknown as Parameters<typeof requireAliasOfIdColumn>[0];

		await expect(requireAliasOfIdColumn(knex)).resolves.toBeUndefined();
	});

	it('throws an actionable error when the column is missing', async () => {
		const knex = {
			schema: { hasColumn: () => Promise.resolve(false) },
		} as unknown as Parameters<typeof requireAliasOfIdColumn>[0];

		await expect(requireAliasOfIdColumn(knex)).rejects.toThrow(/viewer-build/);
	});
});
