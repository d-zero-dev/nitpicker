import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { ClusterSiblingList } from './cluster-sibling-list.js';

const meta = {
	component: ClusterSiblingList,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof ClusterSiblingList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two sibling clusters split off the same blocking group. */
export const Populated: Story = {
	args: {
		siblingClusterKeys: [
			'["css:166e4235afcb8b15","cluster:1"]',
			'["css:166e4235afcb8b15","cluster:2"]',
		],
	},
};

/** No siblings: the component returns `null`. */
export const Empty: Story = { args: { siblingClusterKeys: [] } };
