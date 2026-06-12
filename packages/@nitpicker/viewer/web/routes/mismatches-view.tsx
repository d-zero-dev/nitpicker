import type { MismatchType } from '../api/use-mismatches.js';

import { useSearchParams } from 'react-router';

import { useMismatches } from '../api/use-mismatches.js';
import { DiffCell } from '../components/diff-cell.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';
import { diffText } from '../utils/diff-text.js';

/** Selectable mismatch types (technical terms, shown verbatim). */
const MISMATCH_TYPES: MismatchType[] = ['canonical', 'og:title', 'og:description'];

/**
 * The mismatches view: pages whose canonical / og:title / og:description
 * disagree with their actual values, shown as a red/green character diff.
 * @returns The mismatches view element.
 */
export function MismatchesView() {
	const [params, setParams] = useSearchParams();
	const { t } = useI18n();
	const type = (params.get('type') as MismatchType | null) ?? 'canonical';
	const { data, isLoading, error } = useMismatches(type);

	return (
		<div>
			<ViewHeader
				titleKey="views.mismatches.title"
				descriptionKey="views.mismatches.description"
			/>
			<div className="filter-bar">
				<select
					aria-label={t('common.type')}
					value={type}
					onChange={(e) => {
						const next = new URLSearchParams(params);
						next.set('type', e.target.value);
						setParams(next);
					}}>
					{MISMATCH_TYPES.map((mismatchType) => (
						<option key={mismatchType} value={mismatchType}>
							{mismatchType}
						</option>
					))}
				</select>
			</div>
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{error && <div className="state state-error">{error.message}</div>}
			{data?.length === 0 && <div className="state">{t('views.mismatches.empty')}</div>}
			{data && data.length > 0 && (
				<table className="vt-table" style={{ display: 'table' }}>
					<thead>
						<tr style={{ display: 'table-row' }}>
							<th>{t('views.mismatches.colUrl')}</th>
							<th>{t('views.mismatches.actual')}</th>
							<th>{t('views.mismatches.expected')}</th>
						</tr>
					</thead>
					<tbody style={{ display: 'table-row-group' }}>
						{data.map((entry, index) => {
							const diff = diffText(entry.actual ?? '', entry.expected ?? '');
							return (
								<tr key={`${entry.url}-${index}`}>
									<td>{entry.url}</td>
									<td>
										<DiffCell segments={diff.actual} />
									</td>
									<td>
										<DiffCell segments={diff.expected} />
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}
		</div>
	);
}
