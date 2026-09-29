import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildScopeMap } from '../../crawler/build-scope-map.js';
import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { markInScopeContentItems } from './mark-in-scope-content-items.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'mark-in-scope-source.sqlite');
const destFile = path.resolve(workingDir, 'mark-in-scope-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('markInScopeContentItems', () => {
	it('marks only in-scope internal rows, skipping external rows even when their URL would otherwise match', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const inScope = await seedContentItem(source, 'https://example.com/blog/post', {
			isExternal: 0,
		});
		const outOfScope = await seedContentItem(source, 'https://example.com/about', {
			isExternal: 0,
		});
		const externalButUrlMatches = await seedContentItem(
			source,
			'https://example.com/blog/external-head-only',
			{ isExternal: 1 },
		);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			const scope = buildScopeMap(['https://example.com/blog/']);
			const count = await markInScopeContentItems(dest, scope);

			expect(count).toBe(1);
			const rows = await dest('xfer_ci_in_scope').select('src_id');
			expect(rows.map((r) => r.src_id)).toEqual([inScope]);
			expect(rows.map((r) => r.src_id)).not.toContain(outOfScope);
			expect(rows.map((r) => r.src_id)).not.toContain(externalButUrlMatches);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('silently skips a row whose stored URL is not parseable, rather than throwing', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const [urlRef] = await source('url_refs')
			.insert({ url: 'not a url at all' })
			.returning('id');
		await source('content_items').insert({
			url_id: urlRef.id,
			is_external: 0,
			scraped: 1,
			is_target: 1,
		});
		const validRow = await seedContentItem(source, 'https://example.com/blog/', {
			isExternal: 0,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			const scope = buildScopeMap(['https://example.com/blog/']);
			const count = await markInScopeContentItems(dest, scope);
			expect(count).toBe(1);
			const rows = await dest('xfer_ci_in_scope').select('src_id');
			expect(rows.map((r) => r.src_id)).toEqual([validRow]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('writes every matching id across the 500-row chunk boundary', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const expectedIds: number[] = [];
		for (let i = 0; i < 501; i++) {
			const id = await seedContentItem(source, `https://example.com/blog/post-${i}`, {
				isExternal: 0,
			});
			expectedIds.push(id);
		}
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			const scope = buildScopeMap(['https://example.com/blog/']);
			const count = await markInScopeContentItems(dest, scope);
			expect(count).toBe(501);
			const rows = await dest('xfer_ci_in_scope').select('src_id');
			expect(rows).toHaveLength(501);
			expect(new Set(rows.map((r) => r.src_id))).toEqual(new Set(expectedIds));
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('returns 0 and writes nothing when scope is empty', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		await seedContentItem(source, 'https://example.com/blog/', { isExternal: 0 });
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			const count = await markInScopeContentItems(dest, new Map());
			expect(count).toBe(0);
			const rows = await dest('xfer_ci_in_scope').select('src_id');
			expect(rows).toHaveLength(0);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
