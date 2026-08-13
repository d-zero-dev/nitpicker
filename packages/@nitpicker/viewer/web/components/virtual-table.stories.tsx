import type { DemoRow } from './demo-table-fixtures.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { fn } from 'storybook/test';

import { buildDemoRows, demoTableColumns } from './demo-table-fixtures.js';
import { VirtualTable } from './virtual-table.js';

/** More rows than the paged-table demos: virtualization only matters at scale. */
const rows = buildDemoRows(500);

const meta = {
	component: VirtualTable<DemoRow>,
	args: {
		columns: demoTableColumns,
		total: 4123,
		isFetching: false,
		onLoadMore: fn(),
	},
} satisfies Meta<typeof VirtualTable<DemoRow>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** More rows are available on scroll. */
export const Default: Story = { args: { data: rows, hasNextPage: true } };

/** Every matching row has already been loaded. */
export const AllLoaded: Story = { args: { data: rows, hasNextPage: false } };

/** Initial load: skeleton rows in place of data. */
export const Loading: Story = { args: { data: [], hasNextPage: true, isLoading: true } };
