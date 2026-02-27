import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { loadConfig } from './load-config.js';

vi.mock('node:fs/promises');

describe('loadConfig', () => {
	it('returns empty object when filePath is null', async () => {
		const result = await loadConfig(null);
		expect(result).toEqual({});
	});

	it('reads and parses config from absolute path', async () => {
		const config = { plugins: { analyze: { '@nitpicker/analyze-axe': true } } };
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

		const result = await loadConfig('/absolute/path/config.json');

		expect(fs.readFile).toHaveBeenCalledWith('/absolute/path/config.json', {
			encoding: 'utf8',
		});
		expect(result).toEqual(config);
	});

	it('resolves relative path before reading', async () => {
		const config = {};
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

		await loadConfig('./relative/config.json');

		const expectedPath = path.resolve('./relative/config.json');
		expect(fs.readFile).toHaveBeenCalledWith(expectedPath, { encoding: 'utf8' });
	});
});
