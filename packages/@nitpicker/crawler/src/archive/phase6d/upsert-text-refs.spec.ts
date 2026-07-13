import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { countRows } from './test-utils/count-rows.js';
import { setupPhase6DDb } from './test-utils/setup-phase6d-db.js';
import { upsertTextRefs } from './upsert-text-refs.js';

describe('upsertTextRefs', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts previously-missing rows and returns their new ids', async () => {
		const map = await upsertTextRefs(db, ['html/body[1]/img[1]', 'unknown/42']);
		expect(map.get('html/body[1]/img[1]')).toBeTypeOf('number');
		expect(map.get('unknown/42')).toBeTypeOf('number');
		const rows = await db('text_refs').select('text').orderBy('text');
		expect(rows.map((r) => r.text)).toEqual(['html/body[1]/img[1]', 'unknown/42']);
	});

	it('is idempotent — re-upserts return the same ids without duplicating rows', async () => {
		const first = await upsertTextRefs(db, ['unique/1']);
		const second = await upsertTextRefs(db, ['unique/1']);
		expect(second.get('unique/1')).toBe(first.get('unique/1'));
		expect(await countRows(db, 'text_refs')).toBe(1);
	});

	it('ignores empty / null-like inputs', async () => {
		const map = await upsertTextRefs(db, ['', '']);
		expect(map.size).toBe(0);
	});
});
