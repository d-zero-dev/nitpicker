import type { Meta, StoryObj } from '@storybook/react-vite';

/** Block and inline text: `p`, `strong`, `em`, `small`, `blockquote`, `hr`, and the notice paragraphs. */
const meta = {
	title: 'Foundation/Text',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Body paragraphs with the inline emphasis elements. */
export const Paragraphs: Story = {
	render: () => (
		<div>
			<p>
				A paragraph of body text with <strong>strong emphasis</strong>, <em>emphasis</em>{' '}
				and <small>small print</small>. Body text is 14px; every heading level is larger.
			</p>
			<p>
				A second paragraph. Consecutive paragraphs sit directly under each other with no
				margin of their own; a heading above opens its own gap.
			</p>
		</div>
	),
};

/** A heading followed by body text, to read the gap a heading opens. */
export const UnderAHeading: Story = {
	render: () => (
		<div>
			<h2>Section heading</h2>
			<p>The first paragraph under a heading.</p>
			<h3>Sub-section heading</h3>
			<p>The first paragraph under a smaller heading, with a smaller gap.</p>
		</div>
	),
};

/** `blockquote` and a thematic break. */
export const BlockquoteAndRule: Story = {
	render: () => (
		<div>
			<p>Text before the quote.</p>
			<blockquote>
				<p>A quoted passage, set apart by an inline-start rule and dimmed text.</p>
			</blockquote>
			<hr />
			<p>Text after the rule.</p>
		</div>
	),
};

/** The notice paragraphs the views use. */
export const Notices: Story = {
	render: () => (
		<div>
			<p className="view-description">
				A view description: capped at a readable line length and dimmed.
			</p>
			<p className="filter-notice">A filter notice: showing pages under /news/</p>
			<div className="state">A neutral state message.</div>
			<div className="state state-error">An error state message.</div>
		</div>
	),
};
