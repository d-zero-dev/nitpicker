import type { ConsoleLogEntry } from '@d-zero/beholder';

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { countConsoleLogsByType } from './count-console-logs-by-type.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_count_console_logs_by_type__',
);

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

describe('countConsoleLogsByType', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'count-console-logs-test.nitpicker');

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
				makeEntry({ type: 'error', text: 'e1' }),
				makeEntry({ type: 'error', text: 'e2' }),
				makeEntry({ type: 'warn', text: 'w1' }),
				makeEntry({ type: 'log', text: 'l1' }),
			],
		);
		await archive.setConsoleLogs(
			'https://example.com/b',
			[],
			[
				makeEntry({ type: 'pageerror', text: 'p1' }),
				makeEntry({ type: 'error', text: 'e1' }),
			],
		);
	});

	afterAll(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('counts total occurrences per badge type across all pages', async () => {
		const counts = await countConsoleLogsByType(archive.getKnex());
		expect(counts).toEqual({ pageerror: 1, error: 3, warn: 1 });
	});
});

describe('countConsoleLogsByType: archive predating the page_console_logs table', () => {
	const legacyWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_count_console_logs_by_type_legacy__',
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

	it('returns all-zero counts instead of throwing "no such table"', async () => {
		const counts = await countConsoleLogsByType(archive.getKnex());
		expect(counts).toEqual({ pageerror: 0, error: 0, warn: 0 });
	});
});
