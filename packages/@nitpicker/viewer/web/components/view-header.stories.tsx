import type { Meta, StoryObj } from '@storybook/react-vite';

import { ViewHeader } from './view-header.js';

const meta = {
	component: ViewHeader,
} satisfies Meta<typeof ViewHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Uses real i18n keys from the Pages view so the title/description resolve to actual copy. */
export const Default: Story = {
	args: { titleKey: 'views.pages.title', descriptionKey: 'views.pages.description' },
};

/** An unknown key falls back to rendering the key itself — useful for spotting missing translations. */
export const MissingTranslation: Story = {
	args: {
		titleKey: 'views.doesNotExist.title',
		descriptionKey: 'views.doesNotExist.description',
	},
};
