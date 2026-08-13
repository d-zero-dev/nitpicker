import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatusDistributionBars } from './status-distribution-bars.js';

const meta = {
	component: StatusDistributionBars,
} satisfies Meta<typeof StatusDistributionBars>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		entries: [
			{ status: 200, count: 850 },
			{ status: 301, count: 40 },
			{ status: 404, count: 12 },
		],
	},
};

export const WithInventorySeed404: Story = {
	args: {
		entries: [
			{ status: 200, count: 500 },
			{ status: 404, count: 8 },
			{ status: 404, count: 20, inventorySeed: true },
		],
	},
};

export const WithErrorBreakdown: Story = {
	args: {
		entries: [
			{ status: 200, count: 500 },
			{
				status: -1,
				count: 15,
				errorKindBreakdown: [
					{ kind: 'dns', count: 5, attribution: 'site' },
					{ kind: 'dns', count: 6, attribution: 'network' },
					{ kind: 'timeout', count: 4, attribution: 'network' },
				],
			},
		],
	},
};
