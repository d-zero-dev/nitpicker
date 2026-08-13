import type { Meta, StoryObj } from '@storybook/react-vite';

import { TopBar } from './top-bar.js';

const meta = {
	component: TopBar,
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No props — language/theme toggles and the loading indicator read purely from context. */
export const Default: Story = {};
