import type { Config } from './types.js';

import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import Archive from './archive.js';
import { remove } from './filesystem/remove.js';

const dbLog = vi.hoisted(() => vi.fn());

vi.mock('./debug.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./debug.js')>()),
	dbLog,
}));

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');
const filePath = path.resolve(workingDir, 'config-log-redaction.nitpicker');

const baseConfig = {
	version: '0.13.0',
	name: 'log-redaction',
	baseUrl: 'https://example.com',
	roots: ['https://example.com'],
	recursive: true,
	interval: 0,
	image: true,
	fetchExternal: true,
	parallels: 1,
	excludes: [],
	excludeKeywords: [],
	excludeUrls: [],
	maxExcludedDepth: 10,
	retry: 3,
	fromList: false,
	disableQueries: false,
	userAgent: 'ua',
	ignoreRobots: false,
	requestHeaderNames: ['Authorization'],
} as Config;

afterEach(async () => {
	dbLog.mockClear();
	await remove(filePath).catch(() => {});
});

describe('Archive config logging', () => {
	it('never logs request header values from setConfig / updateConfig, only the names', async () => {
		const archive = await Archive.create({ filePath, cwd: workingDir });
		try {
			// The runtime-only `requestHeaders` rides along exactly as the
			// orchestrator splats its wider options into these calls.
			await archive.setConfig({
				...baseConfig,
				requestHeaders: { Authorization: 'Bearer secret-from-set' },
			} as Config);
			await archive.updateConfig({
				requestHeaders: { 'X-Api-Key': 'secret-from-update' },
			} as Partial<Config>);
		} finally {
			await archive.close();
		}

		const logged = JSON.stringify(dbLog.mock.calls);
		expect(logged).not.toContain('secret-from-set');
		expect(logged).not.toContain('secret-from-update');
		expect(logged).toContain('Authorization');
		expect(logged).toContain('X-Api-Key');
	});
});
