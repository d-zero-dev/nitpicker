import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { InboundLinksSummary } from './inbound-links-summary.js';

const meta = {
	component: InboundLinksSummary,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof InboundLinksSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

const url = 'https://example.com/';

/** A page with inbound links: shows the count and a link to the full list. */
export const WithLinks: Story = {
	args: { url, total: 42, isLoading: false, isUnavailable: false, errorMessage: null },
};

/** A page with no known referrers yet: no link is rendered. */
export const Zero: Story = {
	args: { url, total: 0, isLoading: false, isUnavailable: false, errorMessage: null },
};

/** The count-only query is still loading. */
export const Loading: Story = {
	args: { url, total: null, isLoading: true, isUnavailable: false, errorMessage: null },
};

/** Inbound-link data is unavailable on this archive (predates the feature). */
export const Unavailable: Story = {
	args: { url, total: null, isLoading: false, isUnavailable: true, errorMessage: null },
};

/** The inbound-links query failed. */
export const Error: Story = {
	args: {
		url,
		total: null,
		isLoading: false,
		isUnavailable: false,
		errorMessage: 'Failed to fetch inbound links.',
	},
};
