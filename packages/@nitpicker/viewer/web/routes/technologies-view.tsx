import type { TechnologyDirectoryStatsEntry } from '@nitpicker/query';

import { useState } from 'react';

import { useTechnologies } from '../api/use-technologies.js';
import { useTechnologyPages } from '../api/use-technology-pages.js';
import { AppLink } from '../components/app-link.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Renders one technology's directory distribution (rows already filtered
 * to this technology by the caller) plus its page list, fetched on demand.
 * @param props - The selected technology and the pre-filtered distribution rows.
 * @param props.technology
 * @param props.directoryRows
 */
function TechnologyDrilldown(props: {
	technology: string;
	directoryRows: TechnologyDirectoryStatsEntry[];
}) {
	const { technology, directoryRows } = props;
	const { t } = useI18n();
	const { data, isLoading, error } = useTechnologyPages(technology);

	return (
		<div className="detail-grid">
			<h3>{t('views.technologies.directoryDistribution')}</h3>
			{directoryRows.length === 0 ? (
				<p className="view-description">
					{t('views.technologies.directoryDistributionUnavailable')}
				</p>
			) : (
				<table>
					<thead>
						<tr>
							<th>{t('views.technologies.colDirectory')}</th>
							<th>{t('views.technologies.colPageCount')}</th>
						</tr>
					</thead>
					<tbody>
						{directoryRows
							.toSorted((a, b) => b.pageCount - a.pageCount)
							.map((row) => (
								<tr key={row.directory}>
									<td>{row.directory}</td>
									<td>{row.pageCount}</td>
								</tr>
							))}
					</tbody>
				</table>
			)}

			<h3>{t('views.technologies.pagesForTechnology', { technology })}</h3>
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{error && <div className="state state-error">{error.message}</div>}
			{data && (
				<ul>
					{data.map((page) => (
						<li key={page.url}>
							<AppLink to={`/pages/detail?url=${encodeURIComponent(page.url)}`}>
								{page.url}
							</AppLink>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * Site-wide technology inventory: one row per detected technology (page
 * count, mean confidence), expandable into its directory × technology
 * distribution and page list. Combines beholder's Wappalyzer pass with
 * nitpicker's own structural signals into one confidence score per
 * technology, per page — see `getPageTechnologies` for the per-signal
 * evidence behind any one page's detections.
 * @returns The technologies view element.
 */
export function TechnologiesView() {
	const { t } = useI18n();
	const { data, isLoading, error } = useTechnologies();
	const [selected, setSelected] = useState<string | null>(null);

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
				<table>
					<thead>
						<tr>
							<th>{t('views.technologies.colTechnology')}</th>
							<th>{t('views.technologies.colCategory')}</th>
							<th>{t('views.technologies.colPageCount')}</th>
							<th>{t('views.technologies.colAvgConfidence')}</th>
						</tr>
					</thead>
					<tbody>
						{data.inventory.map((entry) => (
							<>
								<tr
									key={entry.technology}
									onClick={() =>
										setSelected(selected === entry.technology ? null : entry.technology)
									}
									style={{ cursor: 'pointer' }}>
									<td>{entry.technology}</td>
									<td>{entry.category ?? '—'}</td>
									<td>{entry.pageCount}</td>
									<td>{entry.avgConfidence}</td>
								</tr>
								{selected === entry.technology && (
									<tr key={`${entry.technology}-detail`}>
										<td colSpan={4}>
											<TechnologyDrilldown
												technology={entry.technology}
												directoryRows={data.directoryDistribution.filter(
													(row) => row.technology === entry.technology,
												)}
											/>
										</td>
									</tr>
								)}
							</>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
