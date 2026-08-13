import type { Meta, StoryObj } from '@storybook/react-vite';

import { PaginationModeToggle } from './pagination-mode-toggle.js';

const meta = {
	component: PaginationModeToggle,
} satisfies Meta<typeof PaginationModeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No props — mode is a module-level singleton persisted to localStorage; click to toggle MPA/virtual. */
export const Default: Story = {};
