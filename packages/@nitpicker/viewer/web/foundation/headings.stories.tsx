import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * Bare `h1`–`h6` as the global stylesheet renders them. The scale must be
 * strictly decreasing; set heading sizes in `styles.css`, never per component.
 */
const meta = {
	title: 'Foundation/Headings',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every heading level in document order, so inversions are visible at a glance. */
export const Scale: Story = {
	render: () => (
		<div>
			<h1>h1 Heading level 1</h1>
			<h2>h2 Heading level 2</h2>
			<h3>h3 Heading level 3</h3>
			<h4>h4 Heading level 4</h4>
			<h5>h5 Heading level 5</h5>
			<h6>h6 Heading level 6</h6>
		</div>
	),
};

/** A realistic nesting: a section heading followed by body text and a sub-section. */
export const Nested: Story = {
	render: () => (
		<div>
			<h1>Summary</h1>
			<p>Page title with a short description underneath.</p>
			<h2>Status distribution</h2>
			<p>Section body text.</p>
			<h3>Responses</h3>
			<p>Sub-section body text.</p>
			<h3>Errors</h3>
			<p>Another sub-section.</p>
		</div>
	),
};
