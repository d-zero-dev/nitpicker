// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider.js';

import { ErrorsView } from './errors-view.js';

const state = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('../api/use-error-kinds.js', () => ({
	useErrorKinds: () => ({
		data: {
			items: state.items,
			total: state.items.length,
			facets: { totalRecords: 1, channelSource: 'none' },
		},
		isFetching: false,
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
				<ErrorsView />
			</I18nProvider>
		</MemoryRouter>,
	);
}

describe('ErrorsView', () => {
	afterEach(() => {
		cleanup();
		state.items = [];
	});

	it('offers every error kind in the kind filter, including redirect-loop', () => {
		renderAt('/errors');
		const button = screen.getByRole('button', { name: 'Kind' });
		const popover = document.getElementById(button.getAttribute('commandfor') ?? '');
		if (!popover) {
			throw new Error('no filter popover');
		}

		// jsdom has no popover API: dispatch the event the browser fires before showing it.
		const event = new Event('beforetoggle');
		Object.defineProperty(event, 'newState', { value: 'open' });
		act(() => {
			popover.dispatchEvent(event);
		});

		const labels = [...popover.querySelectorAll('.pt-filter-option')].map(
			(option) => option.textContent,
		);
		expect(labels).toContain('Redirect loop');
		expect(labels).toContain('DNS');
		expect(labels).toHaveLength(13);
	});

	it('links a list row to its detail view, resetting ?page= and keeping other filters', () => {
		state.items = [{ host: 'a.example', kind: 'dns', attribution: 'site', count: 3 }];
		renderAt('/errors?sortBy=count&page=2');

		const link = screen.getByRole('link', { name: 'a.example' });

		expect(link.getAttribute('href')).toBe(
			'/errors?sortBy=count&host=a.example&kind=dns&attribution=site',
		);
	});

	it('links the detail view back to the list, dropping host/kind/attribution and keeping other filters', () => {
		renderAt('/errors?host=a.example&kind=dns&attribution=site&sortBy=count&page=2');

		const back = screen.getByRole('link', { name: /back/i });

		expect(back.getAttribute('href')).toBe('/errors?sortBy=count');
	});

	it('shows the list (no back link) when host or kind is missing', () => {
		renderAt('/errors?host=a.example');

		expect(screen.queryByRole('link', { name: /back/i })).toBeNull();
	});
});
