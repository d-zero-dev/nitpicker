import type { ConsoleLogEntry } from '@d-zero/beholder';

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listConsoleLogs } from './list-console-logs.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_console_logs__');

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

describe('listConsoleLogs', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'console-logs-test.nitpicker');

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
				makeEntry({ type: 'error', text: 'shared warning' }),
				makeEntry({ type: 'warn', text: 'a-only warning' }),
			],
		);
		await archive.setConsoleLogs(
			'https://example.com/b',
			[],
			[makeEntry({ type: 'error', text: 'shared warning' })],
		);
	});

	afterAll(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('aggregates identical content across pages into one entry with pageCount/totalCount', async () => {
		const result = await listConsoleLogs(archive, { type: 'error' });
		expect(result.total).toBe(1);
		expect(result.items[0]?.text).toBe('shared warning');
		expect(result.items[0]?.pageCount).toBe(2);
		expect(result.items[0]?.totalCount).toBe(2);
	});

	it('filters by type', async () => {
		const result = await listConsoleLogs(archive, { type: 'warn' });
		expect(result.total).toBe(1);
		expect(result.items[0]?.text).toBe('a-only warning');
	});

	it('returns every distinct entry with no filter', async () => {
		const result = await listConsoleLogs(archive);
		expect(result.total).toBe(2);
	});

	it('sorts by text ascending', async () => {
		const result = await listConsoleLogs(archive, { sortBy: 'text', sortOrder: 'asc' });
		expect(result.items.map((i) => i.text)).toEqual(['a-only warning', 'shared warning']);
	});
});

describe('listConsoleLogs: archive predating the console_log_items table', () => {
	const legacyWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_console_logs_legacy__',
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
		// Simulate a read-only stub / pre-#228 archive: drop the tables that
		// `createAdjunctTables` would otherwise self-heal on the next writer
		// open (this is exactly what a read-only connection never reaches).
		await archive.getKnex().schema.dropTable('page_console_logs');
		await archive.getKnex().schema.dropTable('console_log_items');
	});

	afterAll(() => {
		rmSync(legacyWorkingDir, { recursive: true, force: true });
	});

	it('returns an empty page instead of throwing "no such table"', async () => {
		const result = await listConsoleLogs(archive);
		expect(result).toEqual({ items: [], total: 0 });
	});
});
