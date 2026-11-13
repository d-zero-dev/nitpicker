// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider.js';

import { Pager } from './pager.js';

/**
 * @param entry - The initial URL of the memory router.
 * @param currentPage - The active page.
 */
function renderPager(entry: string, currentPage: number) {
	render(
		<MemoryRouter initialEntries={[entry]}>
			<I18nProvider initialLocale="en">
				<Pager
					currentPage={currentPage}
					total={500}
					pageSize={100}
					onPageChange={vi.fn()}
					onPageSizeChange={vi.fn()}
				/>
			</I18nProvider>
		</MemoryRouter>,
	);
}

describe('Pager', () => {
	afterEach(cleanup);

	it('links each page number to ?page=N, keeping other filters', () => {
		renderPager('/pages?urlPattern=%25a%25&page=1', 1);

		const link = screen.getByRole('link', { name: 'Go to page 5' });

		expect(link.getAttribute('href')).toBe('/pages?urlPattern=%25a%25&page=5');
	});

	it('links page 1 without ?page= so the first-page URL stays clean', () => {
		renderPager('/pages?page=3', 3);

		const link = screen.getByRole('link', { name: 'Go to page 1' });

		expect(link.getAttribute('href')).toBe('/pages');
	});

	it('links Previous and Next to the neighbouring pages', () => {
		renderPager('/pages?page=3', 3);

		expect(screen.getByRole('link', { name: 'Previous' }).getAttribute('href')).toBe(
			'/pages?page=2',
		);
		expect(screen.getByRole('link', { name: 'Next' }).getAttribute('href')).toBe(
			'/pages?page=4',
		);
	});

	it('marks the current page with aria-current and does not link it', () => {
		renderPager('/pages?page=2', 2);

		const current = document.querySelector('[aria-current="page"]');

		expect(current?.textContent).toBe('2');
		expect(current?.tagName).toBe('SPAN');
		expect(screen.queryByRole('link', { name: 'Go to page 2' })).toBeNull();
	});

	it('disables Previous on the first page and Next on the last (no href)', () => {
		renderPager('/pages', 1);
		const previous = screen.getByRole('link', { name: 'Previous' });
		cleanup();
		renderPager('/pages?page=5', 5);
		const next = screen.getByRole('link', { name: 'Next' });

		expect(previous.getAttribute('aria-disabled')).toBe('true');
		expect(previous.hasAttribute('href')).toBe(false);
		expect(next.getAttribute('aria-disabled')).toBe('true');
		expect(next.hasAttribute('href')).toBe(false);
	});
});
