import { describe, it, expect } from 'vitest';

import { requireConsoleErrorCountColumn } from './require-console-error-count-column.js';

describe('requireConsoleErrorCountColumn', () => {
	it('resolves when page_meta.console_error_count exists', async () => {
		const knex = {
			schema: { hasColumn: () => Promise.resolve(true) },
		} as unknown as Parameters<typeof requireConsoleErrorCountColumn>[0];

		await expect(requireConsoleErrorCountColumn(knex)).resolves.toBeUndefined();
	});

	it('throws an actionable error when the column is missing', async () => {
		const knex = {
			schema: { hasColumn: () => Promise.resolve(false) },
		} as unknown as Parameters<typeof requireConsoleErrorCountColumn>[0];

		await expect(requireConsoleErrorCountColumn(knex)).rejects.toThrow(/viewer-build/);
	});
});
