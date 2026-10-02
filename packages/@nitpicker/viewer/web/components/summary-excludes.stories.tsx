import type { Meta, StoryObj } from '@storybook/react-vite';

import { SummaryExcludes } from './summary-excludes.js';

const meta = {
	component: SummaryExcludes,
} satisfies Meta<typeof SummaryExcludes>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All four settings present; collapsed until opened. */
export const Default: Story = {
	args: {
		excludes: ['/private/', '\\.pdf$'],
		excludeKeywords: ['logout', 'session'],
		excludeUrls: ['https://example.com/admin/'],
		maxExcludedDepth: 3,
	},
};

/** Hundreds of patterns: collapsed they cost one line; opened they simply list. */
export const ManyPatterns: Story = {
	args: {
		excludes: Array.from({ length: 300 }, (_, index) => `/section-${index}/`),
		excludeKeywords: [],
		excludeUrls: [],
		maxExcludedDepth: 0,
	},
};

/** Nothing excluded: the whole block is absent. */
export const Empty: Story = {
	args: {
		excludes: [],
		excludeKeywords: [],
		excludeUrls: [],
		maxExcludedDepth: 0,
	},
};
