// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider.js';

import { StatusDistributionBars } from './status-distribution-bars.js';

/**
 * @param entries - The status-distribution entries to render.
 */
function renderBars(entries: Parameters<typeof StatusDistributionBars>[0]['entries']) {
	return render(
		<MemoryRouter>
			<I18nProvider initialLocale="en">
				<StatusDistributionBars entries={entries} />
			</I18nProvider>
		</MemoryRouter>,
	);
}

describe('StatusDistributionBars', () => {
	afterEach(cleanup);

	it('exposes a fetch-error row that has a breakdown as a labelled group', () => {
		renderBars([
			{
				status: -1,
				count: 15,
				errorKindBreakdown: [{ kind: 'dns', count: 15, attribution: 'site' }],
			},
		]);

		expect(
			screen.getByRole('group', { name: 'Fetch error breakdown (15 pages)' }),
		).toBeTruthy();
	});

	it('renders rows without a breakdown as plain blocks, not groups', () => {
		renderBars([
			{ status: 200, count: 850 },
			{ status: -1, count: 3 },
		]);

		expect(screen.queryAllByRole('group')).toHaveLength(0);
	});
});
