import type { Meta, StoryObj } from '@storybook/react-vite';

import { TableList } from './table-list.js';

const meta = {
	component: TableList,
} satisfies Meta<typeof TableList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tables with a mix of header/footer/merged-cell characteristics. */
export const Default: Story = {
	args: {
		tables: [
			{ rows: 5, cols: 3, hasHeader: true, hasFooter: false, hasMergedCell: false },
			{ rows: 2, cols: 2, hasHeader: false, hasFooter: true, hasMergedCell: true },
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { tables: [] } };
