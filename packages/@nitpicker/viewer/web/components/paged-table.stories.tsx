import type { DemoRow } from './demo-table-fixtures.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { fn } from 'storybook/test';

import { buildDemoRows, demoTableColumns } from './demo-table-fixtures.js';
import { PagedTable } from './paged-table.js';

const rows = buildDemoRows(20);

const meta = {
	component: PagedTable<DemoRow>,
	args: {
		columns: demoTableColumns,
		total: 4123,
		currentPage: 4,
		pageSize: 100,
		isFetching: false,
		onPageChange: fn(),
		onPageSizeChange: fn(),
	},
} satisfies Meta<typeof PagedTable<DemoRow>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A full page of loaded rows. */
export const Default: Story = { args: { data: rows } };

/** Initial load: skeleton rows in place of data. */
export const Loading: Story = { args: { data: [], isLoading: true } };

/** No matching rows for the current filter. */
export const Empty: Story = { args: { data: [], total: 0 } };
