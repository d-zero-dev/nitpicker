import type { StaticTableColumn } from '../report-ui/types.js';
import type { Key } from 'react';

/**
 * Renders an accessible, non-interactive table without pagination, sorting,
 * virtualization, or data-fetching dependencies.
 * @param props - Rows, stable row keys, and column renderers.
 * @param props.rows
 * @param props.rowKey
 * @param props.columns
 * @returns A static table preserving the caller-provided row order.
 * @example
 * ```tsx
 * <StaticTable
 *   rows={[{ id: 1, name: 'Home' }]}
 *   rowKey={(row) => row.id}
 *   columns={[{ key: 'name', label: 'Name', render: (row) => row.name }]}
 * />
 * ```
 */
export function StaticTable<Row>(props: {
	rows: readonly Row[];
	rowKey: (row: Row, index: number) => Key;
	columns: readonly StaticTableColumn<Row>[];
}) {
	return (
		<div className="report-table-scroll">
			<table className="report-table">
				<thead>
					<tr>
						{props.columns.map((column) => (
							<th key={column.key} scope="col">
								{column.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{props.rows.map((row, rowIndex) => (
						<tr key={props.rowKey(row, rowIndex)}>
							{props.columns.map((column) => (
								<td key={column.key}>{column.render(row)}</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
