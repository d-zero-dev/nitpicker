import type { Meta, StoryObj } from '@storybook/react-vite';

import { CanvasList } from './canvas-list.js';

const meta = {
	component: CanvasList,
} satisfies Meta<typeof CanvasList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A couple of canvases with different bitmap dimensions. */
export const Default: Story = {
	args: {
		canvases: [
			{ width: 800, height: 600 },
			{ width: 300, height: 150 },
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { canvases: [] } };
