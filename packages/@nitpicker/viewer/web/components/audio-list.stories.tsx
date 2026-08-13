import type { Meta, StoryObj } from '@storybook/react-vite';

import { AudioList } from './audio-list.js';

const meta = {
	component: AudioList,
} satisfies Meta<typeof AudioList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A couple of audio elements. */
export const Default: Story = {
	args: {
		audios: [
			{ src: 'https://example.com/track.mp3' },
			{ src: 'https://example.com/ad.mp3' },
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { audios: [] } };
