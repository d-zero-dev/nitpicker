import { describe, it, expect } from 'vitest';

import { buildCreateSheetListFromChoices } from './build-create-sheet-list.js';

describe('buildCreateSheetListFromChoices', () => {
	it('returns no factories when only Summary is selected', () => {
		expect(buildCreateSheetListFromChoices(['Summary'])).toHaveLength(0);
	});

	it('includes Page List when selected', () => {
		const list = buildCreateSheetListFromChoices(['Page List']);
		expect(list).toHaveLength(1);
	});
});
