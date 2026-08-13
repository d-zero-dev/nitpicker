import type { Meta, StoryObj } from '@storybook/react-vite';

import { IframeList } from './iframe-list.js';

const meta = {
	component: IframeList,
} satisfies Meta<typeof IframeList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An iframe with a title and one without. */
export const Default: Story = {
	args: {
		iframes: [
			{
				src: 'https://example.com/embed',
				title: 'Embedded widget',
				width: '600',
				height: '400',
			},
			{ src: 'https://ads.example/', title: null, width: null, height: null },
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { iframes: [] } };
