import { describe, it, expect } from 'vitest';

import { hasPageTemplateClustersTable } from './has-page-template-clusters-table.js';

describe('hasPageTemplateClustersTable', () => {
	it('returns true when the table exists', async () => {
		const knex = {
			schema: { hasTable: () => Promise.resolve(true) },
		} as unknown as Parameters<typeof hasPageTemplateClustersTable>[0];

		await expect(hasPageTemplateClustersTable(knex)).resolves.toBe(true);
	});

	it('returns false when the table is absent', async () => {
		const knex = {
			schema: { hasTable: () => Promise.resolve(false) },
		} as unknown as Parameters<typeof hasPageTemplateClustersTable>[0];

		await expect(hasPageTemplateClustersTable(knex)).resolves.toBe(false);
	});
});
