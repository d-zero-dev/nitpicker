import { describe, expect, it, vi } from 'vitest';

import { addChecklistFilter, createTableControls } from './create-table-controls.js';

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

	it('checks defaultValues when the URL omits the filter key entirely', () => {
		const updateMany = vi.fn();
		const params = new URLSearchParams();
		const controls = createTableControls({ params, updateMany });

		addChecklistFilter(
			controls,
			{ params, updateMany },
			'scope',
			'isExternal',
			'Scope',
			[
				{ value: 'false', label: 'Internal' },
				{ value: 'true', label: 'External' },
			],
			['false'],
		);

		expect(controls.filter?.scope?.options).toEqual([
			{ value: 'false', label: 'Internal', checked: true },
			{ value: 'true', label: 'External', checked: false },
		]);
	});

	it('lets an explicit (even empty) URL selection override defaultValues', () => {
		const updateMany = vi.fn();
		const params = new URLSearchParams('isExternal=true');
		const controls = createTableControls({ params, updateMany });

		addChecklistFilter(
			controls,
			{ params, updateMany },
			'scope',
			'isExternal',
			'Scope',
			[
				{ value: 'false', label: 'Internal' },
				{ value: 'true', label: 'External' },
			],
			['false'],
		);

		expect(controls.filter?.scope?.options).toEqual([
			{ value: 'false', label: 'Internal', checked: false },
			{ value: 'true', label: 'External', checked: true },
		]);
	});
});
