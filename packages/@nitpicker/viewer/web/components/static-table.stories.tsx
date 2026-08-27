import type { StaticTableColumn } from '../report-ui/types.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { StaticTable } from './static-table.js';

interface ExampleRow {
	id: number;
	name: string;
	status: number;
}

const columns: StaticTableColumn<ExampleRow>[] = [
	{ key: 'name', label: 'Name', render: (row) => row.name },
	{ key: 'status', label: 'Status', render: (row) => row.status },
];

const meta = {
	component: StaticTable<ExampleRow>,
} satisfies Meta<typeof StaticTable<ExampleRow>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		rows: [
			{ id: 1, name: 'Home', status: 200 },
			{ id: 2, name: 'Missing', status: 404 },
		],
		rowKey: (row) => row.id,
		columns,
	},
};
