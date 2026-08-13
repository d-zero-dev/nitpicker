import type { Meta, StoryObj } from '@storybook/react-vite';

import { LanguageToggle } from './language-toggle.js';

const meta = {
	component: LanguageToggle,
} satisfies Meta<typeof LanguageToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No props — reads and writes the active locale via `useI18n()`. Use the toolbar's Locale global to see it reflect the current selection. */
export const Default: Story = {};
