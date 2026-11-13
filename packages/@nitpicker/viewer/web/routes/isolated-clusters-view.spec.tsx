// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider.js';

import { IsolatedClustersView } from './isolated-clusters-view.js';

const state = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('../api/use-paged-query.js', () => ({
	usePagedQuery: () => ({
		data: { items: state.items, total: state.items.length },
		isFetching: false,
		isLoading: false,
		isError: false,
		error: null,
	}),
}));

vi.mock('../api/use-isolated-clusters-infinite.js', () => ({
	useIsolatedClustersInfinite: () => ({
		data: undefined,
		isFetching: false,
		isLoading: false,
		isError: false,
		error: null,
		hasNextPage: false,
		fetchNextPage: () => Promise.resolve(),
	}),
}));

vi.mock('../api/use-isolated-cluster.js', () => ({
	useIsolatedCluster: () => ({
		data: { members: [], size: 0 },
		isLoading: false,
		isError: false,
		error: null,
	}),
}));

/**
 * @param entry - The initial URL of the memory router.
 */
function renderAt(entry: string) {
	return render(
		<MemoryRouter initialEntries={[entry]}>
			<I18nProvider initialLocale="en">
				<IsolatedClustersView />
			</I18nProvider>
		</MemoryRouter>,
	);
}

describe('IsolatedClustersView', () => {
	afterEach(() => {
		cleanup();
		state.items = [];
	});

	it('links a cluster row to its detail view, resetting ?page= and keeping other filters', () => {
		state.items = [
			{
				representativeUrl: 'https://example.com/a',
				size: 3,
				representativeTitle: 'A',
				representativeStatus: 200,
			},
		];
		renderAt('/isolated-clusters?sortBy=size&page=2');

		const link = screen.getByRole('link', { name: 'https://example.com/a' });

		expect(link.getAttribute('href')).toBe(
			'/isolated-clusters?sortBy=size&cluster=https%3A%2F%2Fexample.com%2Fa',
		);
	});

	it('links the detail view back to the list, dropping only the cluster param', () => {
		renderAt('/isolated-clusters?cluster=https%3A%2F%2Fexample.com%2Fa&sortBy=size');

		const back = screen.getByRole('link', { name: /back/i });

		expect(back.getAttribute('href')).toBe('/isolated-clusters?sortBy=size');
	});
});
