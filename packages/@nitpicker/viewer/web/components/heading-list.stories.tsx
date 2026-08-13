import type { Meta, StoryObj } from '@storybook/react-vite';

import { HeadingList } from './heading-list.js';

const meta = {
	component: HeadingList,
} satisfies Meta<typeof HeadingList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A typical heading outline within the main-content region. */
export const Default: Story = {
	args: {
		headings: [
			{ text: 'Welcome', level: 1 },
			{ text: 'Section one', level: 2 },
			{ text: null, level: 3 },
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { headings: [] } };
