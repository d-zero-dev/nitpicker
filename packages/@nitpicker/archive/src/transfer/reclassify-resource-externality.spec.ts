import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildScopeMap } from '../scope/build-scope-map.js';
import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';

import { reclassifyResourceExternality } from './reclassify-resource-externality.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');
const destFile = path.resolve(workingDir, 'reclassify-resource-dest.sqlite');

afterEach(async () => {
	await fs.rm(destFile, { force: true });
});

describe('reclassifyResourceExternality', () => {
	it('flips a resource in the new scope from external to internal, and vice versa', async () => {
		const dest = await buildFullSchemaTestDb(destFile, null);
		const [nowInScopeUrl] = await dest('url_refs')
			.insert({ url: 'https://a.example.com/style.css' })
			.returning('id');
		const [nowInScope] = await dest('resource_items')
			.insert({ url_id: nowInScopeUrl.id, is_external: 1 })
			.returning('id');
		const [nowOutOfScopeUrl] = await dest('url_refs')
			.insert({ url: 'https://b.example.com/style.css' })
			.returning('id');
		const [nowOutOfScope] = await dest('resource_items')
			.insert({ url_id: nowOutOfScopeUrl.id, is_external: 0 })
			.returning('id');

		const scope = buildScopeMap(['https://a.example.com/']);
		const flipped = await reclassifyResourceExternality(dest, scope);

		expect(flipped).toBe(2);
		const a = await dest('resource_items').where('id', nowInScope.id).first();
		expect(a.is_external).toBe(0);
		const b = await dest('resource_items').where('id', nowOutOfScope.id).first();
		expect(b.is_external).toBe(1);
		await dest.destroy();
	});

	it('is a no-op when nothing changed', async () => {
		const dest = await buildFullSchemaTestDb(destFile, null);
		const [url] = await dest('url_refs')
			.insert({ url: 'https://a.example.com/style.css' })
			.returning('id');
		await dest('resource_items').insert({ url_id: url.id, is_external: 0 });

		const scope = buildScopeMap(['https://a.example.com/']);
		const flipped = await reclassifyResourceExternality(dest, scope);
		expect(flipped).toBe(0);
		await dest.destroy();
	});
});
