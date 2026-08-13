import type { Meta, StoryObj } from '@storybook/react-vite';

import { ThemeToggle } from './theme-toggle.js';

const meta = {
	component: ThemeToggle,
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * No props — `useTheme()` resolves its own initial state from
 * localStorage/`matchMedia` independently of the toolbar's Theme global, so
 * toggling the toolbar changes the page's CSS variables but not this
 * component's own rendered icon. Click the button itself to see it flip.
 */
export const Default: Story = {};
