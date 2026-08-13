import type { Meta, StoryObj } from '@storybook/react-vite';

import { DuplicateUrlList } from './duplicate-url-list.js';

const meta = {
	component: DuplicateUrlList,
} satisfies Meta<typeof DuplicateUrlList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		urls: [
			'https://example.com/products/1',
			'https://example.com/products/2',
			'https://example.com/products/3',
		],
	},
};

export const SingleUrl: Story = {
	args: { urls: ['https://example.com/products/1'] },
};

export const Empty: Story = {
	args: { urls: [] },
};
