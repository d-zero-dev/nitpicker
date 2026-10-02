import type { Meta, StoryObj } from '@storybook/react-vite';

/** Literal text: inline `code` and a `pre` block. */
const meta = {
	title: 'Foundation/Code',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Inline `code`: file names, paths and keys are always set in it, never run into prose. */
export const Inline: Story = {
	render: () => (
		<div>
			<p>
				The stylesheet <code>product.css</code> is loaded from <code>/assets/</code>,
				under the key <code>{'["css:166e4235afcb8b15","cluster:0"]'}</code>.
			</p>
			<h3>
				Common stylesheets: <code>product.css</code>, <code>site.css</code>
			</h3>
		</div>
	),
};

/** A `pre` block: the code inside loses its inline chip. */
export const Block: Story = {
	render: () => (
		<pre>
			<code>{`npx @nitpicker/cli analyze <archive> --templates\nnpx @nitpicker/cli viewer <archive>`}</code>
		</pre>
	),
};
