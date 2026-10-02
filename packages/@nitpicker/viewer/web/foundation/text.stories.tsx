import type { Meta, StoryObj } from '@storybook/react-vite';

/** Inline and block text elements: `p`, `a`, `code`, `small`. */
const meta = {
	title: 'Foundation/Text',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Body paragraphs with a link, inline code and small print. */
export const Paragraphs: Story = {
	render: () => (
		<div>
			<p>
				A paragraph with a <a href="https://example.com/">link</a>, some{' '}
				<code>inline code</code> and <small>small print</small>.
			</p>
			<p className="view-description">
				A view description paragraph, capped at a readable measure.
			</p>
		</div>
	),
};
