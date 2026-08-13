import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { NavSidebar } from './nav-sidebar.js';

const meta = {
	component: NavSidebar,
	decorators: [
		(Story) => (
			<MemoryRouter initialEntries={['/pages']}>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof NavSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `NavLink` needs a router context, unlike the other components in this directory — added only here, not as a global decorator. */
export const Default: Story = {};
