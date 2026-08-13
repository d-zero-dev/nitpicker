import type { Meta, StoryObj } from '@storybook/react-vite';

import { ClusterStylesheetUrlList } from './cluster-stylesheet-url-list.js';

const meta = {
	component: ClusterStylesheetUrlList,
} satisfies Meta<typeof ClusterStylesheetUrlList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The common-stylesheet call site, with URLs present. */
export const Common: Story = {
	args: {
		titleKey: 'views.templateClusters.commonStylesheets',
		urls: [
			'https://example.test/assets/site.css',
			'https://example.test/assets/theme.css',
		],
		caveatKey: 'views.templateClusters.commonCssCaveat',
		emptyLabelKey: 'views.templateClusters.noCommonCss',
	},
};

/** The common-stylesheet call site with no URLs: falls back to the empty label. */
export const CommonEmpty: Story = {
	args: {
		titleKey: 'views.templateClusters.commonStylesheets',
		urls: [],
		caveatKey: 'views.templateClusters.commonCssCaveat',
		emptyLabelKey: 'views.templateClusters.noCommonCss',
	},
};

/** The distinctive-stylesheet call site, with URLs present. */
export const Distinctive: Story = {
	args: {
		titleKey: 'views.templateClusters.distinctiveStylesheets',
		urls: ['https://example.test/assets/product.css'],
		caveatKey: 'views.templateClusters.distinctiveCssCaveat',
	},
};

/** The distinctive-stylesheet call site with no URLs: renders `null` (no `emptyLabelKey`). */
export const DistinctiveEmpty: Story = {
	args: {
		titleKey: 'views.templateClusters.distinctiveStylesheets',
		urls: [],
		caveatKey: 'views.templateClusters.distinctiveCssCaveat',
	},
};
