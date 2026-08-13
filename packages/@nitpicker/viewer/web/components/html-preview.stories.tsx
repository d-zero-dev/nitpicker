import type { Meta, StoryObj } from '@storybook/react-vite';

import { HtmlPreview } from './html-preview.js';

const meta = {
	component: HtmlPreview,
} satisfies Meta<typeof HtmlPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleHtml =
	'<!doctype html>\n<html>\n<head><title>Sample</title></head>\n<body>\n<h1>Hello, world</h1>\n<p>A stored HTML snapshot.</p>\n</body>\n</html>\n';

/** Full snapshot, not truncated. */
export const Default: Story = {
	args: { html: sampleHtml, truncated: false },
};

/** Snapshot exceeded the stored max length. */
export const Truncated: Story = {
	args: { html: sampleHtml, truncated: true },
};
