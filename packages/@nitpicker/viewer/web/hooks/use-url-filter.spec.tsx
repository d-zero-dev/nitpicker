// @vitest-environment jsdom

import type { ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { applyFilterUpdates } from './apply-filter-updates.js';
import { useUrlFilter } from './use-url-filter.js';

/**
 * @param entry - The initial URL of the memory router.
 * @returns A wrapper component for `renderHook`.
 */
function routerAt(entry: string) {
	return function Wrapper(props: { children: ReactNode }) {
		return <MemoryRouter initialEntries={[entry]}>{props.children}</MemoryRouter>;
	};
}

describe('useUrlFilter', () => {
	it('updateMany navigates to the same query applyFilterUpdates computes', () => {
		const entry = '/pages?host=a.example&status=200&page=3';
		const updates = [
			['host', 'b.example'],
			['status', ['200', '404']],
		] as const;
		const expected = applyFilterUpdates(
			new URLSearchParams('host=a.example&status=200&page=3'),
			updates,
		);

		const { result } = renderHook(() => useUrlFilter(), { wrapper: routerAt(entry) });
		act(() => {
			result.current.updateMany(updates);
		});

		expect(result.current.params.toString()).toBe(expected.toString());
		expect(result.current.params.has('page')).toBe(false);
	});

	it('updateMany leaves the URL alone when nothing changes', () => {
		const { result } = renderHook(() => useUrlFilter(), {
			wrapper: routerAt('/pages?host=a.example&page=3'),
		});
		act(() => {
			result.current.updateMany([['host', 'a.example']]);
		});

		expect(result.current.params.toString()).toBe('host=a.example&page=3');
	});
});
