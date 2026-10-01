import { describe, expect, it } from 'vitest';

import { templateLabelSelectColumns } from './template-label-select-columns.js';

describe('templateLabelSelectColumns', () => {
	it('selects the two ptl columns when the join is present', () => {
		const knex = { raw: () => 'unused' } as unknown as Parameters<
			typeof templateLabelSelectColumns
		>[0];
		expect(templateLabelSelectColumns(knex, true)).toEqual([
			'ptl.section as templateLabelSection',
			'ptl.ordinal as templateLabelOrdinal',
		]);
	});

	it('degrades to NULL literals under the same aliases when the join is absent', () => {
		const raws: string[] = [];
		const knex = {
			raw: (sql: string) => {
				raws.push(sql);
				return { sql };
			},
		} as unknown as Parameters<typeof templateLabelSelectColumns>[0];
		expect(templateLabelSelectColumns(knex, false)).toEqual([
			{ sql: 'NULL as templateLabelSection' },
			{ sql: 'NULL as templateLabelOrdinal' },
		]);
		expect(raws).toEqual([
			'NULL as templateLabelSection',
			'NULL as templateLabelOrdinal',
		]);
	});
});
