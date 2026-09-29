import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listPluginDataEntries } from './list-plugin-data-entries.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const tmpDir = path.resolve(__dirname, '__mock__', 'list-plugin-data-tmp');

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('listPluginDataEntries', () => {
	it('excludes known non-plugin entries and reports the rest', async () => {
		await fs.mkdir(path.join(tmpDir, 'inventory'), { recursive: true });
		await fs.mkdir(path.join(tmpDir, 'analysis'), { recursive: true });
		await fs.writeFile(path.join(tmpDir, 'db.sqlite'), '');
		await fs.writeFile(path.join(tmpDir, '.nitpicker-cache-ready'), '');
		await fs.writeFile(path.join(tmpDir, 'error.log'), '');

		const entries = await listPluginDataEntries(tmpDir);
		expect(entries).toEqual(['analysis']);
	});

	it('returns an empty array when there is no plugin data', async () => {
		await fs.mkdir(tmpDir, { recursive: true });
		await fs.writeFile(path.join(tmpDir, 'db.sqlite'), '');
		expect(await listPluginDataEntries(tmpDir)).toEqual([]);
	});
});
