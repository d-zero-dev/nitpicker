import type { Meta, StoryObj } from '@storybook/react-vite';

import { ErrorKindBreakdownList } from './error-kind-breakdown-list.js';

const meta = {
	component: ErrorKindBreakdownList,
} satisfies Meta<typeof ErrorKindBreakdownList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		parentCount: 12,
		breakdown: [
			{ kind: 'dns', count: 8, attribution: 'site' },
			{ kind: 'timeout', count: 4, attribution: 'site' },
		],
	},
};

export const WithNetworkAttribution: Story = {
	args: {
		parentCount: 20,
		breakdown: [
			{ kind: 'dns', count: 5, attribution: 'site' },
			{ kind: 'dns', count: 10, attribution: 'network' },
			{ kind: 'timeout', count: 5, attribution: 'network' },
		],
	},
};
