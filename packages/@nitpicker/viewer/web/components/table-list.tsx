import type { MainContentTableEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link TableList}. */
export interface TableListProps {
	/** Tables within the main region, in DOM order. */
	tables: readonly MainContentTableEntry[];
}

/**
 * Tables found within a page's detected main-content region.
 * @param props - The table entries to render.
 * @returns The tables section, or `null` when there are none.
 */
export function TableList(props: TableListProps) {
	const { t } = useI18n();
	const { tables } = props;
	if (tables.length === 0) {
		return null;
	}
	return (
		<>
			<h3>
				{t('views.pageDetail.mainContentTables')} ({tables.length})
			</h3>
			<ul>
				{tables.map((table, index) => (
					<li key={index}>
						{table.rows}×{table.cols}
						{table.hasHeader ? ', header' : ''}
						{table.hasFooter ? ', footer' : ''}
						{table.hasMergedCell ? ', merged cells' : ''}
					</li>
				))}
			</ul>
		</>
	);
}
