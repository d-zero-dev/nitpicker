import type { Meta, StoryObj } from '@storybook/react-vite';

import { fn } from 'storybook/test';

import { Pager } from './pager.js';

const meta = {
	component: Pager,
	args: {
		onPageChange: fn(),
		onPageSizeChange: fn(),
	},
} satisfies Meta<typeof Pager>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A mid-range page on a large result set — the common case. */
export const Default: Story = {
	args: { currentPage: 4, total: 4123, pageSize: 100 },
};

/** First page: the Prev button is disabled. */
export const FirstPage: Story = {
	args: { currentPage: 1, total: 4123, pageSize: 100 },
};

/** A single short page: pager collapses to page 1 of 1. */
export const SinglePage: Story = {
	args: { currentPage: 1, total: 12, pageSize: 100 },
};
