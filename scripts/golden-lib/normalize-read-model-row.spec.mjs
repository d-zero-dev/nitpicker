import { describe, it, expect } from 'vitest';

import { normalizeReadModelRow } from './normalize-read-model-row.mjs';

describe('normalizeReadModelRow', () => {
	it('drops the build timestamp, which differs on every build', () => {
		expect(
			normalizeReadModelRow('viewer_read_model_meta', {
				id: 1,
				schema_version: 40,
				built_at: 123,
				source_row_count: 5,
			}),
		).toEqual({ id: 1, schema_version: 40, source_row_count: 5 });
	});

	it('leaves other tables untouched, even a column that happens to be named built_at', () => {
		const row = { page_id: 1, built_at: 'x' };
		expect(normalizeReadModelRow('viewer_pages', row)).toEqual(row);
	});

	it('drops the __rowid helper column of any table', () => {
		expect(normalizeReadModelRow('viewer_pages', { __rowid: 3, page_id: 3 })).toEqual({
			page_id: 3,
		});
	});

	it('does not mutate its input', () => {
		const row = { __rowid: 1, built_at: 2 };
		normalizeReadModelRow('viewer_read_model_meta', row);
		expect(row).toEqual({ __rowid: 1, built_at: 2 });
	});
});
