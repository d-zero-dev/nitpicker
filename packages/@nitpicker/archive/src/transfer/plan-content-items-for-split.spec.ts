import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildScopeMap } from '../scope/build-scope-map.js';
import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { markInScopeContentItems } from './mark-in-scope-content-items.js';
import { planContentItemsForSplit } from './plan-content-items-for-split.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'plan-split-source.sqlite');
const destFile = path.resolve(workingDir, 'plan-split-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('planContentItemsForSplit', () => {
	it('keeps core + promoted redirect targets full, stubs referenced rows, drops the rest', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, {
			roots: ['https://example.com/blog/', 'https://example.com/'],
		});
		const blog = await seedContentItem(source, 'https://example.com/blog/', {
			scraped: 1,
			isExternal: 0,
		});
		const blogPost = await seedContentItem(source, 'https://example.com/blog/post', {
			scraped: 1,
			isExternal: 0,
		});
		const about = await seedContentItem(source, 'https://example.com/about', {
			scraped: 1,
			isExternal: 0,
		});
		const orphan = await seedContentItem(source, 'https://example.com/orphan', {
			scraped: 1,
			isExternal: 0,
		});
		const redirector = await seedContentItem(
			source,
			'https://example.com/blog/redirector',
			{
				scraped: 1,
				isExternal: 0,
			},
		);
		const softNotFoundTarget = await seedContentItem(
			source,
			'https://example.com/soft-404-target',
			{ scraped: 1, isExternal: 0 },
		);
		const externalRef = await seedContentItem(source, 'https://external.example/page', {
			scraped: 1,
			isExternal: 1,
		});

		await source('content_items')
			.where('id', redirector)
			.update({ redirect_dest_id: softNotFoundTarget });
		await source('anchor_edges').insert([
			{ page_id: blog, href_page_id: about, count: 1 },
			{ page_id: blogPost, href_page_id: externalRef, count: 1 },
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			const scope = buildScopeMap(['https://example.com/blog/']);
			await markInScopeContentItems(dest, scope);
			await planContentItemsForSplit(dest);

			const rows: { src_id: number; action: number }[] = await dest
				.select('src_id', 'action')
				.from('xfer_ci_plan')
				.orderBy('src_id');
			const byId = new Map(rows.map((r) => [r.src_id, r.action]));

			expect(byId.get(blog)).toBe(TRANSFER_ACTION.full);
			expect(byId.get(blogPost)).toBe(TRANSFER_ACTION.full);
			expect(byId.get(redirector)).toBe(TRANSFER_ACTION.full);
			expect(byId.get(softNotFoundTarget)).toBe(TRANSFER_ACTION.full);
			expect(byId.get(about)).toBe(TRANSFER_ACTION.stub);
			expect(byId.get(externalRef)).toBe(TRANSFER_ACTION.stub);
			expect(byId.has(orphan)).toBe(false);
			expect(rows).toHaveLength(6);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('leaves the plan empty when nothing is in scope', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		await seedContentItem(source, 'https://example.com/elsewhere', {
			scraped: 1,
			isExternal: 0,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			const scope = buildScopeMap(['https://example.com/blog/']);
			await markInScopeContentItems(dest, scope);
			await planContentItemsForSplit(dest);
			const rows = await dest.select('*').from('xfer_ci_plan');
			expect(rows).toHaveLength(0);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
