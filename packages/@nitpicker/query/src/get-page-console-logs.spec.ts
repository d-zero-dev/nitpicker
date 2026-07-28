import type { ConsoleLogEntry } from '@d-zero/beholder';

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getPageConsoleLogs } from './get-page-console-logs.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_get_page_console_logs__');

/**
 * Builds a minimal `ConsoleLogEntry`.
 * @param overrides - Fields to override on top of the default `log` shape.
 */
function makeEntry(overrides: Partial<ConsoleLogEntry> = {}): ConsoleLogEntry {
	return {
		pageUrl: 'https://example.com/',
		type: 'log',
		text: 'hello',
		args: [],
		ts: 1000,
		...overrides,
	};
}

describe('getPageConsoleLogs', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'page-console-logs-test.nitpicker');

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://example.com'],
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
		});

		await archive.setConsoleLogs(
			'https://example.com/a',
			[],
			[
				{ ...makeEntry({ text: 'first' }), ts: 1 },
				{ ...makeEntry({ text: 'second' }), ts: 2 },
			],
		);
		await archive.setConsoleLogs(
			'https://example.com/b',
			[],
			[
				makeEntry({
					type: 'pageerror',
					text: 'boom',
					args: [],
					stack: 'Error: boom\n at app.js:1',
				}),
			],
		);
	});

	afterAll(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns entries for the requested page ordered by ts', async () => {
		const entries = await getPageConsoleLogs(archive, 'https://example.com/a');
		expect(entries.map((e) => e.text)).toEqual(['first', 'second']);
	});

	it('returns the stack trace for a pageerror entry', async () => {
		const entries = await getPageConsoleLogs(archive, 'https://example.com/b');
		expect(entries).toHaveLength(1);
		expect(entries[0]?.type).toBe('pageerror');
		expect(entries[0]?.stack).toBe('Error: boom\n at app.js:1');
	});

	it('returns an empty array for a page with no console logs', async () => {
		const entries = await getPageConsoleLogs(archive, 'https://example.com/nonexistent');
		expect(entries).toEqual([]);
	});

	it('returns args: null instead of throwing when the stored args JSON is corrupt', async () => {
		const knex = archive.getKnex();
		const [jsonRefRow] = (await knex('json_refs')
			.insert({
				hash: Buffer.from('corrupt-args-test'),
				json_text: 'not valid json{{{',
				codec: 'none',
				size_raw: 18,
				size_stored: 18,
			})
			.returning('id')) as { id: number }[];

		const [consoleLogRow] = (await knex('console_log_items as cli')
			.join('text_refs as tr', 'tr.id', 'cli.text_id')
			.where('tr.text', 'first')
			.select('cli.id')) as { id: number }[];

		await knex('console_log_items')
			.where('id', consoleLogRow!.id)
			.update({ args_json_id: jsonRefRow!.id });

		const entries = await getPageConsoleLogs(archive, 'https://example.com/a');
		const first = entries.find((e) => e.text === 'first');
		expect(first?.args).toBeNull();
	});
});

describe('getPageConsoleLogs: archive predating the page_console_logs table', () => {
	const legacyWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_get_page_console_logs_legacy__',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		mkdirSync(legacyWorkingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(legacyWorkingDir, 'legacy-test.nitpicker'),
			cwd: legacyWorkingDir,
		});
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://example.com'],
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
		});
		await archive.getKnex().schema.dropTable('page_console_logs');
		await archive.getKnex().schema.dropTable('console_log_items');
	});

	afterAll(() => {
		rmSync(legacyWorkingDir, { recursive: true, force: true });
	});

	it('returns an empty array instead of throwing "no such table"', async () => {
		const entries = await getPageConsoleLogs(archive, 'https://example.com/a');
		expect(entries).toEqual([]);
	});
});
