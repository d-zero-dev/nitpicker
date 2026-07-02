import { describe, expect, it, vi } from 'vitest';

import { addRadioFilter, createTableControls } from './create-table-controls.js';

describe('addRadioFilter', () => {
	it('falls back to the checked option when the URL omits the filter key', () => {
		const updateMany = vi.fn();
		const params = new URLSearchParams();
		const controls = createTableControls({ params, updateMany });

		addRadioFilter(controls, { params, updateMany }, 'scope', 'isExternal', 'Scope', [
			{ value: 'all', label: 'All', checked: false },
			{ value: 'false', label: 'Internal', checked: true },
			{ value: 'true', label: 'External', checked: false },
		]);

		expect(controls.filter?.scope?.options).toEqual([
			{ value: 'all', label: 'All', checked: false },
			{ value: 'false', label: 'Internal', checked: true },
			{ value: 'true', label: 'External', checked: false },
		]);
	});

	it('keeps explicit defaultValue precedence when no option is pre-checked', () => {
		const updateMany = vi.fn();
		const params = new URLSearchParams();
		const controls = createTableControls({ params, updateMany });

		addRadioFilter(
			controls,
			{ params, updateMany },
			'type',
			'type',
			'Type',
			[
				{ value: 'broken', label: 'Broken', checked: false },
				{ value: 'external', label: 'External', checked: false },
			],
			'broken',
		);

		expect(controls.filter?.type?.options).toEqual([
			{ value: 'broken', label: 'Broken', checked: true },
			{ value: 'external', label: 'External', checked: false },
		]);
	});
});
