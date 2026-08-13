import type { Meta, StoryObj } from '@storybook/react-vite';

import { SkipLink } from './skip-link.js';

const meta = {
	component: SkipLink,
} satisfies Meta<typeof SkipLink>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Visually hidden until focused — press Tab to reveal it. */
export const Default: Story = {};
