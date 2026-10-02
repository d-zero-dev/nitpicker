import type { Meta, StoryObj } from '@storybook/react-vite';

/** Bare `ul` / `ol` / `dl` and `details` as the global stylesheet renders them. */
const meta = {
	title: 'Foundation/Lists',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** `ul` and `ol` side by side: the ordered list must read as richly as the unordered one. */
export const UnorderedAndOrdered: Story = {
	render: () => (
		<div>
			<h2>Unordered</h2>
			<ul>
				<li>https://example.com/</li>
				<li>https://example.com/news/</li>
				<li>https://example.com/docs/</li>
			</ul>
			<h2>Ordered</h2>
			<ol>
				<li>https://example.com/</li>
				<li>https://example.com/news/</li>
				<li>https://example.com/docs/</li>
			</ol>
		</div>
	),
};

/** Nested lists. */
export const Nested: Story = {
	render: () => (
		<ol>
			<li>
				Crawl
				<ul>
					<li>Fetch pages</li>
					<li>Save snapshots</li>
				</ul>
			</li>
			<li>Analyze</li>
			<li>Report</li>
		</ol>
	),
};

/** A description list using the shared `detail-grid` layout. */
export const Description: Story = {
	render: () => (
		<dl className="detail-grid">
			<dt>Pages</dt>
			<dd>1,234</dd>
			<dt>Top directory</dt>
			<dd>/news/</dd>
			<dt>Stylesheets</dt>
			<dd>
				<ul>
					<li>https://example.com/a.css</li>
					<li>https://example.com/b.css</li>
				</ul>
			</dd>
		</dl>
	),
};

/** Collapsed and expanded disclosure widgets. */
export const Details: Story = {
	render: () => (
		<div>
			<details>
				<summary>Collapsed (3)</summary>
				<ul>
					<li>one</li>
					<li>two</li>
					<li>three</li>
				</ul>
			</details>
			<details open>
				<summary>Expanded (2)</summary>
				<ul>
					<li>one</li>
					<li>two</li>
				</ul>
			</details>
		</div>
	),
};
