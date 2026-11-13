import type { ColumnDef } from '../types.js';
import type { IsolatedClusterListPaneProps } from './isolated-cluster-list-pane.js';
import type { IsolatedClusterSummary } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';
import { fn } from 'storybook/test';

import { IsolatedClusterListPane } from './isolated-cluster-list-pane.js';

const columns: ColumnDef<IsolatedClusterSummary>[] = [
	{ accessorKey: 'representativeUrl', header: 'Representative URL' },
	{ accessorKey: 'size', header: 'Size' },
	{ accessorKey: 'representativeTitle', header: 'Title' },
	{ accessorKey: 'representativeStatus', header: 'Status' },
];

const rows: IsolatedClusterSummary[] = Array.from({ length: 12 }, (_, i) => ({
	representativeUrl: `https://example.com/cluster-${i + 1}`,
	representativeTitle: `Sample cluster ${i + 1}`,
	representativeStatus: 200,
	size: 2 + i,
}));

const meta = {
	component: IsolatedClusterListPane,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof IsolatedClusterListPane>;

export default meta;
// Props are a discriminated union on `mode`, which `StoryObj<typeof meta>` collapses to
// `never`; typing the stories by the props type keeps each story checked against its branch.
type Story = StoryObj<IsolatedClusterListPaneProps>;

/** MPA mode: page-numbered navigation. */
export const Mpa: Story = {
	args: {
		mode: 'mpa',
		data: rows,
		columns,
		total: rows.length,
		currentPage: 1,
		pageSize: 100,
		isFetching: false,
		onPageChange: fn(),
		onPageSizeChange: fn(),
	},
};

/** Virtual mode: infinite-scroll accumulation. */
export const Virtual: Story = {
	args: {
		mode: 'virtual',
		data: rows,
		columns,
		total: rows.length,
		hasNextPage: false,
		isFetching: false,
		onLoadMore: fn(),
	},
};
