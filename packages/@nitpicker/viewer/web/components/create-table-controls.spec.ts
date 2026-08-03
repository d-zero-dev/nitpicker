import { describe, expect, it, vi } from 'vitest';

import {
	addChecklistFilter,
	addRadioFilter,
	createTableControls,
} from './create-table-controls.js';

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

describe('addChecklistFilter', () => {
	it('marks options as checked based on repeated URL query values, ignoring any caller-supplied checked', () => {
		const updateMany = vi.fn();
		const params = new URLSearchParams('status=200&status=404');
		const controls = createTableControls({ params, updateMany });

		addChecklistFilter(controls, { params, updateMany }, 'status', 'status', 'Status', [
			{ value: '200', label: '200' },
			{ value: '404', label: '404' },
			{ value: '500', label: '500' },
		]);

		expect(controls.filter?.status?.options).toEqual([
			{ value: '200', label: '200', checked: true },
			{ value: '404', label: '404', checked: true },
			{ value: '500', label: '500', checked: false },
		]);
	});

	it('sends the full selected array to updateMany on apply', () => {
		const updateMany = vi.fn();
		const params = new URLSearchParams();
		const controls = createTableControls({ params, updateMany });

		addChecklistFilter(controls, { params, updateMany }, 'status', 'status', 'Status', [
			{ value: '200', label: '200' },
			{ value: '404', label: '404' },
		]);

		controls.filter?.status?.onApply(['200', '404']);

		expect(updateMany).toHaveBeenCalledWith([['status', ['200', '404']]]);
	});

	it('clears the filter key when applied with an empty selection', () => {
		const updateMany = vi.fn();
		const params = new URLSearchParams('status=200');
		const controls = createTableControls({ params, updateMany });

		addChecklistFilter(controls, { params, updateMany }, 'status', 'status', 'Status', [
			{ value: '200', label: '200' },
		]);

		controls.filter?.status?.onApply([]);

		expect(updateMany).toHaveBeenCalledWith([['status', []]]);
	});
});
