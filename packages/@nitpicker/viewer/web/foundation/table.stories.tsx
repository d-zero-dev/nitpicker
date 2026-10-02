import type { Meta, StoryObj } from '@storybook/react-vite';

import { StaticTable } from '../components/static-table.js';

/** `table`: the shared plain table for static data, its cell variants, expandable rows, and the report table. */
const meta = {
	title: 'Foundation/Table',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const REPORT_ROWS = [
	{ url: 'https://example.com/', status: 200 },
	{ url: 'https://example.com/missing', status: 404 },
	{ url: 'https://example.com/old', status: 301 },
];

/** Header, numeric column and a nowrap column. */
export const PlainTable: Story = {
	render: () => (
		<div className="plain-table-scroll">
			<table className="plain-table">
				<thead>
					<tr>
						<th className="plain-table-nowrap">Cluster</th>
						<th className="plain-table-num">Pages</th>
						<th>Top directory</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td className="plain-table-nowrap">news template A</td>
						<td className="plain-table-num">120</td>
						<td>
							<code>/news/</code>
						</td>
					</tr>
					<tr>
						<td className="plain-table-nowrap">docs template A</td>
						<td className="plain-table-num">48</td>
						<td>
							<code>/docs/</code>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	),
};

/** Long text in a cell: `plain-table-prose` wraps it instead of widening the column. */
export const ProseCell: Story = {
	render: () => (
		<div className="plain-table-scroll">
			<table className="plain-table">
				<thead>
					<tr>
						<th className="plain-table-nowrap">Name</th>
						<th>Description</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td className="plain-table-nowrap">Wrapping text</td>
						<td>
							<div className="plain-table-prose">
								A long description that keeps going well past one line so the wrapping
								behaviour of the cell is visible: it breaks inside the column rather than
								pushing the table wider than its container.
							</div>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	),
};

/** Rows that expand in place: collapsed, hovered-style and expanded with a detail row. */
export const ExpandableRows: Story = {
	render: () => (
		<div className="plain-table-scroll">
			<table className="plain-table">
				<thead>
					<tr>
						<th>Technology</th>
						<th className="plain-table-num">Pages</th>
					</tr>
				</thead>
				<tbody>
					<tr className="is-expandable">
						<td>Collapsed row</td>
						<td className="plain-table-num">12</td>
					</tr>
					<tr className="is-expandable is-expanded">
						<td>Expanded row</td>
						<td className="plain-table-num">34</td>
					</tr>
					<tr>
						<td colSpan={2} className="plain-table-detail">
							Detail content shown under the expanded row.
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	),
};

/**
 * The report table the static HTML report renders, through the real
 * `StaticTable` component (`plain-table report-table`), with an alert cell.
 */
export const ReportTable: Story = {
	render: () => (
		<StaticTable
			rows={REPORT_ROWS}
			rowKey={(row) => row.url}
			columns={[
				{ key: 'url', label: 'URL', render: (row) => row.url },
				{
					key: 'status',
					label: 'Status',
					render: (row) =>
						row.status >= 400 ? (
							<strong className="report-alert">{row.status}</strong>
						) : (
							row.status
						),
				},
			]}
		/>
	),
};
