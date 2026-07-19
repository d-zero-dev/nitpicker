import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedContentItems } from '../populate-entity-tables/test-utils/seed-content-items.js';
import { setupMigrationDb } from '../populate-entity-tables/test-utils/setup-entities-db.js';

import { checkImageItemsCount } from './check-image-items-count.js';
import { MigrationVerificationError } from './types.js';

describe('checkImageItemsCount', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
		await db('text_refs').insert({ id: 1, hash: Buffer.from([1]), text: 'unknown/1' });
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes when image_items row count equals images row count', async () => {
		await seedContentItems(db, [1]);
		await db('images').insert([
			{ id: 10, pageId: 1, src: 'https://example.com/a.png', sourceCode: '<img>' },
			{ id: 11, pageId: 1, src: 'https://example.com/b.png', sourceCode: '<img>' },
		]);
		await db('image_items').insert([
			{ id: 10, page_id: 1, dom_path_text_id: 1 },
			{ id: 11, page_id: 1, dom_path_text_id: 1 },
		]);
		await expect(checkImageItemsCount(db)).resolves.toBeUndefined();
	});

	it('passes when both tables are empty', async () => {
		await expect(checkImageItemsCount(db)).resolves.toBeUndefined();
	});

	it('throws when image_items has more rows than images', async () => {
		await seedContentItems(db, [1]);
		await db('images').insert({
			id: 10,
			pageId: 1,
			src: 'https://example.com/a.png',
			sourceCode: '<img>',
		});
		await db('image_items').insert([
			{ id: 10, page_id: 1, dom_path_text_id: 1 },
			{ id: 11, page_id: 1, dom_path_text_id: 1 },
		]);
		await expect(checkImageItemsCount(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});

	it('throws when image_items is missing rows', async () => {
		await seedContentItems(db, [1]);
		await db('images').insert([
			{ id: 10, pageId: 1, src: 'https://example.com/a.png', sourceCode: '<img>' },
			{ id: 11, pageId: 1, src: 'https://example.com/b.png', sourceCode: '<img>' },
		]);
		await db('image_items').insert({ id: 10, page_id: 1, dom_path_text_id: 1 });
		await expect(checkImageItemsCount(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});
});
