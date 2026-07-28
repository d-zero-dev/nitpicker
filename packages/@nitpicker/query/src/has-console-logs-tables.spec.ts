import { describe, it, expect } from 'vitest';

import { hasConsoleLogsTables } from './has-console-logs-tables.js';

describe('hasConsoleLogsTables', () => {
	it('returns true when both tables exist', async () => {
		const knex = {
			schema: { hasTable: () => Promise.resolve(true) },
		} as unknown as Parameters<typeof hasConsoleLogsTables>[0];

		await expect(hasConsoleLogsTables(knex)).resolves.toBe(true);
	});

	it('returns false when both tables are absent', async () => {
		const knex = {
			schema: { hasTable: () => Promise.resolve(false) },
		} as unknown as Parameters<typeof hasConsoleLogsTables>[0];

		await expect(hasConsoleLogsTables(knex)).resolves.toBe(false);
	});

	it('returns false when only console_log_items exists', async () => {
		const knex = {
			schema: {
				hasTable: (name: string) => Promise.resolve(name === 'console_log_items'),
			},
		} as unknown as Parameters<typeof hasConsoleLogsTables>[0];

		await expect(hasConsoleLogsTables(knex)).resolves.toBe(false);
	});

	it('returns false when only page_console_logs exists', async () => {
		const knex = {
			schema: {
				hasTable: (name: string) => Promise.resolve(name === 'page_console_logs'),
			},
		} as unknown as Parameters<typeof hasConsoleLogsTables>[0];

		await expect(hasConsoleLogsTables(knex)).resolves.toBe(false);
	});
});
