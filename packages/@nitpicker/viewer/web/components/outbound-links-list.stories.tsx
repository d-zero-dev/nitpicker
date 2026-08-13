import type { OutboundLink } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { OutboundLinksList } from './outbound-links-list.js';

const meta = {
	component: OutboundLinksList,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof OutboundLinksList>;

export default meta;
type Story = StoryObj<typeof meta>;

const links: OutboundLink[] = [
	{
		url: 'https://example.com/about',
		textContent: 'About',
		status: 200,
		isExternal: false,
	},
	{
		url: 'https://example.com/contact',
		textContent: 'Contact',
		status: 404,
		isExternal: false,
	},
	{
		url: 'https://other.example/',
		textContent: 'Partner',
		status: null,
		isExternal: true,
	},
];

/** A page with a handful of outbound links, some with a known HTTP status. */
export const Default: Story = { args: { links } };

/** More than `MAX_LINKS_DISPLAYED` links: the list is truncated with a count note. */
export const Truncated: Story = {
	args: {
		links: Array.from({ length: 250 }, (_, i) => ({
			url: `https://example.com/page-${i + 1}`,
			textContent: null,
			status: 200,
			isExternal: false,
		})),
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { links: [] } };
