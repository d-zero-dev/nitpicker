import type { Meta, StoryObj } from '@storybook/react-vite';

import { RedirectFromList } from './redirect-from-list.js';

const meta = {
	component: RedirectFromList,
} satisfies Meta<typeof RedirectFromList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page with a couple of legacy URLs redirecting to it. */
export const Default: Story = {
	args: { urls: ['https://example.com/old-page', 'https://example.com/legacy'] },
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { urls: [] } };
