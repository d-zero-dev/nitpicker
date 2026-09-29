import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { flattenRedirectChains } from './flatten-redirect-chains.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');
const destFile = path.resolve(workingDir, 'flatten-redirect-chains-dest.sqlite');

afterEach(async () => {
	await fs.rm(destFile, { force: true });
});

describe('flattenRedirectChains', () => {
	it('flattens a two-hop chain to a single hop', async () => {
		const dest = await buildFullSchemaTestDb(destFile, null);
		const p = await seedContentItem(dest, 'https://example.com/p/');
		const x = await seedContentItem(dest, 'https://example.com/x/');
		const y = await seedContentItem(dest, 'https://example.com/y/');
		await dest('content_items').where('id', p).update({ redirect_dest_id: x });
		await dest('content_items').where('id', x).update({ redirect_dest_id: y });

		const result = await flattenRedirectChains(dest);

		expect(result.cyclesBroken).toBe(0);
		const row = await dest('content_items').where('id', p).first();
		expect(row.redirect_dest_id).toBe(y);
		await dest.destroy();
	});

	it('breaks a two-node cycle by nulling both sides', async () => {
		const dest = await buildFullSchemaTestDb(destFile, null);
		const a = await seedContentItem(dest, 'https://example.com/a/');
		const b = await seedContentItem(dest, 'https://example.com/b/');
		await dest('content_items').where('id', a).update({ redirect_dest_id: b });
		await dest('content_items').where('id', b).update({ redirect_dest_id: a });

		const result = await flattenRedirectChains(dest, 4);

		expect(result.cyclesBroken).toBe(2);
		const rowA = await dest('content_items').where('id', a).first();
		const rowB = await dest('content_items').where('id', b).first();
		expect(rowA.redirect_dest_id).toBeNull();
		expect(rowB.redirect_dest_id).toBeNull();
		await dest.destroy();
	});

	it('clears a self-loop', async () => {
		const dest = await buildFullSchemaTestDb(destFile, null);
		const p = await seedContentItem(dest, 'https://example.com/self/');
		await dest('content_items').where('id', p).update({ redirect_dest_id: p });

		const result = await flattenRedirectChains(dest);

		expect(result.cyclesBroken).toBe(1);
		const row = await dest('content_items').where('id', p).first();
		expect(row.redirect_dest_id).toBeNull();
		await dest.destroy();
	});

	it('is a no-op when every chain is already flat', async () => {
		const dest = await buildFullSchemaTestDb(destFile, null);
		const p = await seedContentItem(dest, 'https://example.com/p/');
		const y = await seedContentItem(dest, 'https://example.com/y/');
		await dest('content_items').where('id', p).update({ redirect_dest_id: y });

		const result = await flattenRedirectChains(dest);
		expect(result.flattened).toBe(0);
		expect(result.cyclesBroken).toBe(0);
		await dest.destroy();
	});
});
