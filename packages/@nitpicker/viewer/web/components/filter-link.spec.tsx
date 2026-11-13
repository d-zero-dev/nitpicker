// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { FilterLink } from './filter-link.js';

describe('FilterLink', () => {
	afterEach(cleanup);

	it('links to the current page with the updates applied, keeping other filters and resetting ?page=', () => {
		render(
			<MemoryRouter initialEntries={['/errors?sortBy=count&page=2']}>
				<FilterLink
					className="link-button"
					updates={[
						['host', 'a.example'],
						['kind', 'dns'],
					]}>
					a.example
				</FilterLink>
			</MemoryRouter>,
		);

		const link = screen.getByRole('link', { name: 'a.example' });

		expect(link.getAttribute('href')).toBe(
			'/errors?sortBy=count&host=a.example&kind=dns',
		);
		expect(link.className).toBe('link-button');
	});

	it('links to the unchanged query when the updates change nothing', () => {
		render(
			<MemoryRouter initialEntries={['/errors?host=a.example&page=2']}>
				<FilterLink updates={[['host', 'a.example']]}>same</FilterLink>
			</MemoryRouter>,
		);

		expect(screen.getByRole('link', { name: 'same' }).getAttribute('href')).toBe(
			'/errors?host=a.example&page=2',
		);
	});
});
