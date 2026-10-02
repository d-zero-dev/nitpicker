import type { Meta, StoryObj } from '@storybook/react-vite';

import { SummaryRoots } from './summary-roots.js';

const meta = {
	component: SummaryRoots,
} satisfies Meta<typeof SummaryRoots>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One root: shown large on its own. */
export const Single: Story = {
	args: { roots: ['https://example.com/'] },
};

/** A multi-root crawl lists every root. */
export const Multiple: Story = {
	args: {
		roots: [
			'https://example.com/',
			'https://example.org/docs/',
			'https://www.example.net/',
		],
	},
};

/** A very long URL wraps instead of overflowing. */
export const LongUrl: Story = {
	args: {
		roots: [
			'https://example.com/a/very/long/path/that/keeps/going/and/going/and/going/until/it/must/wrap/somewhere/index.html',
		],
	},
};
