import type { ColumnDef } from '../types.js';
import type { IsolatedClusterMember } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

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
} satisfies Meta<typeof IsolatedClusterDetailPane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** MPA mode: page-numbered navigation over the cluster's members. */
export const Mpa: Story = {
	args: {
		representativeUrl: 'https://example.com/a',
		onBack: fn(),
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
		onBack: fn(),
		mode: 'virtual',
		data: members,
		columns,
		total: members.length,
		hasNextPage: false,
		isFetching: false,
		onLoadMore: fn(),
	},
};
