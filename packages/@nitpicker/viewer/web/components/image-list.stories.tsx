import type { Meta, StoryObj } from '@storybook/react-vite';

import { ImageList } from './image-list.js';

const meta = {
	component: ImageList,
} satisfies Meta<typeof ImageList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A couple of images, one with alt text and one without. */
export const Default: Story = {
	args: {
		images: [
			{ src: 'https://example.com/hero.jpg', alt: 'A hero banner' },
			{ src: 'https://example.com/deco.png', alt: '' },
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { images: [] } };
