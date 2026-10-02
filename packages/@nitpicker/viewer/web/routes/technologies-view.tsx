import { useTechnologies } from '../api/use-technologies.js';
import { AppLink } from '../components/app-link.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Site-wide technology inventory: one row per detected technology (page
 * count, mean confidence). Each technology links to the Pages list filtered
 * to the pages that use it (`/pages?technology=`), so paging, sorting and
 * every other Pages filter apply to that list instead of a second,
 * technology-only list living inside this table. Combines beholder's
 * Wappalyzer pass with nitpicker's own structural signals into one
 * confidence score per technology, per page — see `getPageTechnologies` for
 * the per-signal evidence behind any one page's detections.
 * @returns The technologies view element.
 */
export function TechnologiesView() {
	const { t } = useI18n();
	const { data, isLoading, error } = useTechnologies();

	return (
		<div>
			<ViewHeader
				titleKey="views.technologies.title"
				descriptionKey="views.technologies.description"
			/>
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{error && <div className="state state-error">{error.message}</div>}
			{data && data.inventory.length === 0 && (
				<div className="state">{t('views.technologies.empty')}</div>
			)}
			{data && data.inventory.length > 0 && (
				<div className="plain-table-scroll">
					<table className="plain-table">
						<thead>
							<tr>
								<th>{t('views.technologies.colTechnology')}</th>
								<th>{t('views.technologies.colCategory')}</th>
								<th className="plain-table-num">
									{t('views.technologies.colPageCount')}
								</th>
								<th className="plain-table-num">
									{t('views.technologies.colAvgConfidence')}
								</th>
							</tr>
						</thead>
						<tbody>
							{data.inventory.map((entry) => (
								<tr key={entry.technology}>
									<td>
										<AppLink
											to={`/pages?technology=${encodeURIComponent(entry.technology)}`}>
											{entry.technology}
										</AppLink>
									</td>
									<td>{entry.category ?? '—'}</td>
									<td className="plain-table-num">{entry.pageCount}</td>
									<td className="plain-table-num">{entry.avgConfidence}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
