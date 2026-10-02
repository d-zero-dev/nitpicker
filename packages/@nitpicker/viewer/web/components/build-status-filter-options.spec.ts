import { describe, expect, it } from 'vitest';

import { buildStatusFilterOptions } from './build-status-filter-options.js';

interface Row {
	status: number | null;
}

const t = (key: string) => (key === 'common.statusFetchError' ? 'Fetch error' : key);

describe('buildStatusFilterOptions', () => {
	it('collects distinct statuses from the visible items, sorted ascending', () => {
		const items: Row[] = [{ status: 404 }, { status: 200 }, { status: 200 }];
		expect(
			buildStatusFilterOptions({
				items,
				getStatus: (item) => item.status,
				t,
				currentStatuses: [],
			}),
		).toEqual([
			{ value: '200', label: '200', checked: false },
			{ value: '404', label: '404', checked: false },
		]);
	});

	it('marks every currently selected value as checked', () => {
		const items: Row[] = [{ status: 200 }, { status: 404 }, { status: 500 }];
		const options = buildStatusFilterOptions({
			items,
			getStatus: (item) => item.status,
			t,
			currentStatuses: ['200', '500'],
		});
		expect(options.map((o) => [o.value, o.checked])).toEqual([
			['200', true],
			['404', false],
			['500', true],
		]);
	});

	it('preserves a selected status even when absent from the visible page', () => {
		const items: Row[] = [{ status: 200 }];
		const options = buildStatusFilterOptions({
			items,
			getStatus: (item) => item.status,
			t,
			currentStatuses: ['404'],
		});
		expect(options).toEqual([
			{ value: '200', label: '200', checked: false },
			{ value: '404', label: '404', checked: true },
		]);
	});

	it('ignores null/undefined statuses from items', () => {
		const items: Row[] = [{ status: null }, { status: 200 }];
		expect(
			buildStatusFilterOptions({
				items,
				getStatus: (item) => item.status,
				t,
				currentStatuses: [],
			}),
		).toEqual([{ value: '200', label: '200', checked: false }]);
	});

	it('labels the -1 sentinel as a fetch error while its filter value stays numeric', () => {
		const items: Row[] = [{ status: -1 }, { status: 200 }];
		expect(
			buildStatusFilterOptions({
				items,
				getStatus: (item) => item.status,
				t,
				currentStatuses: [],
			}),
		).toEqual([
			{ value: '-1', label: 'Fetch error', checked: false },
			{ value: '200', label: '200', checked: false },
		]);
	});

	it('produces no options when items and selection are both empty', () => {
		expect(
			buildStatusFilterOptions<Row>({
				items: undefined,
				getStatus: (item) => item.status,
				t,
				currentStatuses: [],
			}),
		).toEqual([]);
	});
});
