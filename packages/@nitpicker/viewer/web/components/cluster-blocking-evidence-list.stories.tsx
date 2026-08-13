import type { TemplateClusterReasonSummary } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ClusterBlockingEvidenceList } from './cluster-blocking-evidence-list.js';

const meta = {
	component: ClusterBlockingEvidenceList,
} satisfies Meta<typeof ClusterBlockingEvidenceList>;

export default meta;
type Story = StoryObj<typeof meta>;

const cssBlocking: TemplateClusterReasonSummary['blocking'] = [
	{
		blockKey: 'css:166e4235afcb8b15',
		reason: { kind: 'css', distinctiveStylesheetHrefs: ['/assets/product.css'] },
	},
];

const pathBlocking: TemplateClusterReasonSummary['blocking'] = [
	{ blockKey: 'path:0', reason: { kind: 'path', pathKey: '/products/' } },
	{ blockKey: 'path:1', reason: { kind: 'orphanMerge', pathKey: '/products/legacy/' } },
];

/** A block formed from a distinctive CSS set. */
export const CssBlocked: Story = { args: { blocking: cssBlocking } };

/** Blocks formed from path-derived keys, including an orphan merge. */
export const PathBlocked: Story = { args: { blocking: pathBlocking } };
