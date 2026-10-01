import { describe, it, expect } from 'vitest';

import { hasPageTemplateLabelsTable } from './has-page-template-labels-table.js';

describe('hasPageTemplateLabelsTable', () => {
	it('returns true when the table exists', async () => {
		const knex = {
			schema: { hasTable: () => Promise.resolve(true) },
		} as unknown as Parameters<typeof hasPageTemplateLabelsTable>[0];

		await expect(hasPageTemplateLabelsTable(knex)).resolves.toBe(true);
	});

	it('returns false when the table is absent', async () => {
		const knex = {
			schema: { hasTable: () => Promise.resolve(false) },
		} as unknown as Parameters<typeof hasPageTemplateLabelsTable>[0];

		await expect(hasPageTemplateLabelsTable(knex)).resolves.toBe(false);
	});
});
