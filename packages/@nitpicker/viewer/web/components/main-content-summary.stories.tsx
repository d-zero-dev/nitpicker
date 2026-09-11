import type { Meta, StoryObj } from '@storybook/react-vite';

import { MainContentSummary } from './main-content-summary.js';

const meta = {
	component: MainContentSummary,
} satisfies Meta<typeof MainContentSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page with a detected main-content region and both scroll heights measured. */
export const Default: Story = {
	args: {
		selector: 'main#content',
		wordCount: 1240,
		bodyWordCount: 1580,
		scrollHeight: { desktop: 3200, mobile: 5400 },
		imageScan: { desktop: 'ok', mobile: 'ok' },
	},
};

/** No main-content element was detected and scroll height was never measured. */
export const NoMainContent: Story = {
	args: {
		selector: null,
		wordCount: 0,
		bodyWordCount: 0,
		scrollHeight: { desktop: null, mobile: null },
		imageScan: { desktop: null, mobile: null },
	},
};

/** The mobile viewport's image scan degraded — network never settled, but the frame was still usable. */
export const MobileImageScanDegraded: Story = {
	args: {
		selector: 'main#content',
		wordCount: 1240,
		bodyWordCount: 1580,
		scrollHeight: { desktop: 3200, mobile: 5400 },
		imageScan: { desktop: 'ok', mobile: 'degraded' },
	},
};

/** The mobile viewport's image scan was abandoned outright (frame/session lost). */
export const MobileImageScanFrameLost: Story = {
	args: {
		selector: 'main#content',
		wordCount: 1240,
		bodyWordCount: 1580,
		scrollHeight: { desktop: 3200, mobile: null },
		imageScan: { desktop: 'ok', mobile: 'frame-lost' },
	},
};
