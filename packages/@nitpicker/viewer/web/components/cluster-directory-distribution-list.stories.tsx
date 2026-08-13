import type { Meta, StoryObj } from '@storybook/react-vite';

import { ClusterDirectoryDistributionList } from './cluster-directory-distribution-list.js';

const meta = {
	component: ClusterDirectoryDistributionList,
} satisfies Meta<typeof ClusterDirectoryDistributionList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two top directories, with long-tail pages outside both. */
export const Populated: Story = {
	args: {
		directories: [
			{ directory: '/blog/', pageCount: 40 },
			{ directory: '/news/', pageCount: 12 },
		],
		otherPageCount: 3,
	},
};

/** Top directories cover every member page: no "N more" note. */
export const NoLongTail: Story = {
	args: { directories: [{ directory: '/', pageCount: 10 }], otherPageCount: 0 },
};

/** No directories were computed: renders the `—` placeholder. */
export const Empty: Story = { args: { directories: [], otherPageCount: 0 } };
