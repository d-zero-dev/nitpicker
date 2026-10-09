import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildScopeMap } from '../scope/build-scope-map.js';
import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { countExternalPagesInScope } from './count-external-pages-in-scope.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');
const destFile = path.resolve(workingDir, 'count-external-in-scope-dest.sqlite');

afterEach(async () => {
	await fs.rm(destFile, { force: true });
});

describe('countExternalPagesInScope', () => {
	it('counts only external rows whose URL is inside the given scope', async () => {
		const dest = await buildFullSchemaTestDb(destFile, null);
		await seedContentItem(dest, 'https://a.example.com/in-scope', { isExternal: 1 });
		await seedContentItem(dest, 'https://b.example.com/out-of-scope', { isExternal: 1 });
		await seedContentItem(dest, 'https://a.example.com/internal', { isExternal: 0 });

		const scope = buildScopeMap(['https://a.example.com/']);
		const count = await countExternalPagesInScope(dest, scope);
		expect(count).toBe(1);
		await dest.destroy();
	});
});
