import type { Meta, StoryObj } from '@storybook/react-vite';

import { SummaryCard } from './summary-card.js';

const meta = {
	component: SummaryCard,
} satisfies Meta<typeof SummaryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: { label: 'Internal pages', value: 1234 },
};
