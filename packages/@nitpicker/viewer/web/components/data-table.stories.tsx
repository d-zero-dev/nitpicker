import type { DataTableMpaProps, DataTableVirtualProps } from './data-table.js';
import type { DemoRow } from './demo-table-fixtures.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { fn } from 'storybook/test';

import { DataTable } from './data-table.js';
import { buildDemoRows, demoTableColumns } from './demo-table-fixtures.js';

const rows = buildDemoRows(20);

const meta = {
	component: DataTable<DemoRow>,
} satisfies Meta<typeof DataTable<DemoRow>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** MPA mode: page-numbered navigation. The `mode` discriminator selects `PagedTable` internally. */
export const Mpa: Story = {
	args: {
		mode: 'mpa',
		data: rows,
		columns: demoTableColumns,
		total: 4123,
		currentPage: 4,
		pageSize: 100,
		isFetching: false,
		onPageChange: fn(),
		onPageSizeChange: fn(),
	} satisfies DataTableMpaProps<DemoRow>,
};

/** Virtual mode: infinite-scroll accumulation, selects `VirtualTable` internally. */
export const Virtual: Story = {
	args: {
		mode: 'virtual',
		data: rows,
		columns: demoTableColumns,
		total: 4123,
		hasNextPage: true,
		isFetching: false,
		onLoadMore: fn(),
	} satisfies DataTableVirtualProps<DemoRow>,
};

/** Query is in an error state: an inline banner surfaces above the (empty) table. */
export const WithError: Story = {
	args: {
		mode: 'mpa',
		data: [],
		columns: demoTableColumns,
		total: 0,
		currentPage: 1,
		pageSize: 100,
		isFetching: false,
		isError: true,
		error: new Error('Read model unavailable — run viewer-build first.'),
		onPageChange: fn(),
		onPageSizeChange: fn(),
	} satisfies DataTableMpaProps<DemoRow>,
};
