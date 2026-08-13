import type { Meta, StoryObj } from '@storybook/react-vite';

import { MetadataFulfillmentBars } from './metadata-fulfillment-bars.js';

const meta = {
	component: MetadataFulfillmentBars,
} satisfies Meta<typeof MetadataFulfillmentBars>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		fulfillment: {
			title: 0.95,
			description: 0.72,
			keywords: 0.3,
			ogTitle: 0.6,
			ogDescription: 0.5,
			ogImage: 0.4,
		},
	},
};

export const AllFulfilled: Story = {
	args: {
		fulfillment: {
			title: 1,
			description: 1,
			keywords: 1,
			ogTitle: 1,
			ogDescription: 1,
			ogImage: 1,
		},
	},
};
