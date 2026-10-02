import type { Meta, StoryObj } from '@storybook/react-vite';

/** The shared plain table (`.plain-table`) used by static, non-paged data. */
const meta = {
	title: 'Foundation/Table',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

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
						<td>/news/</td>
					</tr>
					<tr>
						<td className="plain-table-nowrap">docs template A</td>
						<td className="plain-table-num">48</td>
						<td>/docs/</td>
					</tr>
				</tbody>
			</table>
		</div>
	),
};
