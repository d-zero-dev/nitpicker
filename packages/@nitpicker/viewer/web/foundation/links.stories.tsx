import type { Meta, StoryObj } from '@storybook/react-vite';

import { ExternalUrl } from '../components/external-url.js';

/** Links: a bare `a`, a link inside running text, and a URL link that opens a new window. */
const meta = {
	title: 'Foundation/Links',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A bare anchor, and one inside a sentence. */
export const Anchor: Story = {
	render: () => (
		<div>
			<p>
				<a href="https://example.com/">A bare link</a>
			</p>
			<p>
				A sentence with <a href="https://example.com/docs/">a link in the middle</a> of
				it.
			</p>
		</div>
	),
};

/** A crawled URL: opens a new window and carries the "new window" icon. */
export const ExternalUrlLink: Story = {
	render: () => (
		<p>
			<ExternalUrl url="https://example.com/news/" />
		</p>
	),
};

/** Not HTTP(S): falls back to plain text, never a followable link. */
export const NonHttpUrl: Story = {
	render: () => (
		<p>
			<ExternalUrl url="javascript:alert(1)" />
		</p>
	),
};
