import type { Meta, StoryObj } from '@storybook/react-vite';

import { VideoList } from './video-list.js';

const meta = {
	component: VideoList,
} satisfies Meta<typeof VideoList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A couple of videos with different dimensions. */
export const Default: Story = {
	args: {
		videos: [
			{
				src: 'https://example.com/intro.mp4',
				poster: 'https://example.com/poster.jpg',
				width: 1280,
				height: 720,
			},
			{ src: 'https://example.com/loop.mp4', poster: null, width: 320, height: 240 },
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { videos: [] } };
