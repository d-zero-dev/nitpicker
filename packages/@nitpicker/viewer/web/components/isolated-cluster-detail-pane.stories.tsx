import type { ColumnDef } from '../types.js';
import type { IsolatedClusterDetailPaneProps } from './isolated-cluster-detail-pane.js';
import type { IsolatedClusterMember } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';
import { fn } from 'storybook/test';

import { IsolatedClusterDetailPane } from './isolated-cluster-detail-pane.js';
import { SourceBadge } from './source-badge.js';

const columns: ColumnDef<IsolatedClusterMember>[] = [
	{ accessorKey: 'url', header: 'URL' },
	{ accessorKey: 'title', header: 'Title' },
	{ accessorKey: 'status', header: 'Status' },
	{
		id: 'source',
		header: 'Source',
		accessorFn: (r) => r.source,
		cell: (info) => (
			<SourceBadge source={info.getValue<IsolatedClusterMember['source']>()} />
		),
	},
];

const members: IsolatedClusterMember[] = [
	{
		url: 'https://example.com/a',
		title: 'Page A',
		status: 200,
		source: 'inventory-seed',
	},
	{
		url: 'https://example.com/b',
		title: 'Page B',
		status: 200,
		source: 'inventory-discovered',
	},
	{
		url: 'https://example.com/c',
		title: null,
		status: 404,
		source: 'inventory-discovered',
	},
];

const meta = {
	component: IsolatedClusterDetailPane,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof IsolatedClusterDetailPane>;

export default meta;
// Props are a discriminated union on `mode`, which `StoryObj<typeof meta>` collapses to
// `never`; typing the stories by the props type keeps each story checked against its branch.
type Story = StoryObj<IsolatedClusterDetailPaneProps>;

/** MPA mode: page-numbered navigation over the cluster's members. */
export const Mpa: Story = {
	args: {
		representativeUrl: 'https://example.com/a',
		backTo: { search: '' },
		mode: 'mpa',
		data: members,
		columns,
		total: members.length,
		currentPage: 1,
		pageSize: 100,
		isFetching: false,
		onPageChange: fn(),
		onPageSizeChange: fn(),
	},
};

/** Virtual mode: the full member array handed to the windowed table. */
export const Virtual: Story = {
	args: {
		representativeUrl: 'https://example.com/a',
		backTo: { search: '' },
		mode: 'virtual',
		data: members,
		columns,
		total: members.length,
		hasNextPage: false,
		isFetching: false,
		onLoadMore: fn(),
	},
};
