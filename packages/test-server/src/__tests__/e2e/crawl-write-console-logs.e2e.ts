import type { Knex } from 'knex';

import { getPageConsoleLogs, listConsoleLogs } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_ORIGIN } from './test-server-port.js';

/**
 * Fetches the `console_log_items` row a `page_console_logs` edge points at,
 * joined through `text_refs` for the message text.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageUrlPath - The pathname of the page to look up edges for.
 */
async function getConsoleLogRows(knex: Knex, pageUrlPath: string) {
	return knex('page_console_logs as pcl')
		.join('content_items as ci', 'ci.id', 'pcl.pageId')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.join('console_log_items as cli', 'cli.id', 'pcl.consoleLogId')
		.join('text_refs as tr', 'tr.id', 'cli.text_id')
		.where('ur.url', `${TEST_SERVER_ORIGIN}${pageUrlPath}`)
		.select(
			'cli.type as type',
			'tr.text as text',
			'cli.id as consoleLogId',
			'pcl.ts as ts',
		);
}

describe('crawl captures console logs / page errors into console_log_items and page_console_logs (issue #228)', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl([`${TEST_SERVER_ORIGIN}/console-logs/`]);
	}, 120_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('captures every console message type on a page that logs, warns, and errors', async () => {
		const knex = result.accessor.getKnex();
		const rows = await getConsoleLogRows(knex, '/console-logs/mixed/');
		const types = rows.map((r) => r.type).toSorted();
		expect(types).toEqual(['error', 'log', 'warn']);
	});

	it('captures an uncaught exception as a `pageerror` entry', async () => {
		const knex = result.accessor.getKnex();
		const rows = await getConsoleLogRows(knex, '/console-logs/error/');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.type).toBe('pageerror');
		expect(rows[0]?.text).toContain('boom from error page');
	});

	it('records no console_log rows for a page with no console output', async () => {
		const knex = result.accessor.getKnex();
		const rows = await getConsoleLogRows(knex, '/console-logs/silent/');
		expect(rows).toHaveLength(0);
	});

	it('dedupes an identical warning shared by two pages into one console_log_items row', async () => {
		const knex = result.accessor.getKnex();
		const aRows = await getConsoleLogRows(knex, '/console-logs/shared-a/');
		const bRows = await getConsoleLogRows(knex, '/console-logs/shared-b/');
		expect(aRows).toHaveLength(1);
		expect(bRows).toHaveLength(1);
		expect(aRows[0]?.text).toBe('shared framework warning');
		// Same dictionary row referenced from both pages — not two copies.
		expect(aRows[0]?.consoleLogId).toBe(bRows[0]?.consoleLogId);

		const items = await knex('console_log_items as cli')
			.join('text_refs as tr', 'tr.id', 'cli.text_id')
			.where('tr.text', 'shared framework warning')
			.select('cli.id as id');
		expect(items).toHaveLength(1);
	});

	// The tests above assert against hand-rolled SQL joins that could drift
	// from the actual query-layer implementation without either side
	// noticing. These two exercise the real `@nitpicker/query` functions
	// (the same ones the viewer / MCP / CLI call) against this real-crawled
	// archive, closing that gap.
	it('listConsoleLogs aggregates the real crawl into the same shape the viewer/MCP/CLI consume', async () => {
		// Both the shared-a/shared-b warning AND `mixed`'s own unrelated
		// `console.warn('a warning', ...)` are type=warn, so this crawl has
		// two distinct warn entries — find the shared one specifically
		// rather than assuming it's the only warn-type row.
		const result_ = await listConsoleLogs(result.accessor, { type: 'warn' });
		const shared = result_.items.find((item) => item.text === 'shared framework warning');
		expect(shared).toMatchObject({
			type: 'warn',
			text: 'shared framework warning',
			pageCount: 2,
			totalCount: 2,
		});
	});

	it('getPageConsoleLogs returns every entry the mixed page produced via the real query function', async () => {
		// Order is NOT asserted here: beholder resolves each console call's
		// `args` via an async `jsonValue()` before pushing the entry, so two
		// console calls with different-shaped args (a plain string vs. an
		// object) can resolve — and land in `consoleLogs` — out of the
		// order they were made in the page's script. `ts` reflects capture
		// (push) order, not script-execution order.
		const entries = await getPageConsoleLogs(
			result.accessor,
			`${TEST_SERVER_ORIGIN}/console-logs/mixed/`,
		);
		expect(entries.map((e) => e.type).toSorted()).toEqual(['error', 'log', 'warn']);
	});
});
