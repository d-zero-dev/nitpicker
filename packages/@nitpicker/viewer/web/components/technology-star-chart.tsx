import type { PageTechnologiesResult } from '../api/use-page-technologies.js';

import { useState } from 'react';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link TechnologyStarChart}. */
export interface TechnologyStarChartProps {
	data: PageTechnologiesResult | undefined;
	isLoading: boolean;
	error: Error | null;
}

/**
 * A page's detected-technology star chart: every technology detected on the
 * page, confidence descending, with a per-row expansion showing the raw
 * signals (evidence) that contributed to it.
 * @param props - The page's technologies query result.
 * @returns The technologies section.
 */
export function TechnologyStarChart(props: TechnologyStarChartProps) {
	const { t } = useI18n();
	const { data, isLoading, error } = props;
	const [expandedTechnology, setExpandedTechnology] = useState<string | null>(null);

	return (
		<>
			<h2>{t('views.pageDetail.technologies')}</h2>
			{isLoading && (
				<div className="state">{t('views.pageDetail.loadingTechnologies')}</div>
			)}
			{error && <div className="state state-error">{error.message}</div>}
			{data && data.technologies.length === 0 && (
				<div className="state">{t('views.pageDetail.noTechnologies')}</div>
			)}
			{data && data.technologies.length > 0 && (
				<table>
					<thead>
						<tr>
							<th>{t('views.technologies.colTechnology')}</th>
							<th>{t('views.technologies.colCategory')}</th>
							<th>{t('views.pageDetail.colVersion')}</th>
							<th>{t('views.pageDetail.colConfidence')}</th>
							<th>{t('views.pageDetail.colSignalCount')}</th>
						</tr>
					</thead>
					<tbody>
						{data.technologies.map((tech) => (
							<>
								<tr
									key={tech.technology}
									onClick={() =>
										setExpandedTechnology(
											expandedTechnology === tech.technology ? null : tech.technology,
										)
									}
									style={{ cursor: 'pointer' }}>
									<td>{tech.technology}</td>
									<td>{tech.category ?? '—'}</td>
									<td>{tech.version ?? '—'}</td>
									<td>{tech.confidence}</td>
									<td>{tech.signalCount}</td>
								</tr>
								{expandedTechnology === tech.technology && (
									<tr key={`${tech.technology}-signals`}>
										<td colSpan={5}>
											<table>
												<thead>
													<tr>
														<th>{t('views.pageDetail.colSignalType')}</th>
														<th>{t('views.pageDetail.colEvidence')}</th>
														<th>{t('views.pageDetail.colWeight')}</th>
													</tr>
												</thead>
												<tbody>
													{tech.signals.map((signal, index) => (
														<tr key={`${signal.signalType}-${index}`}>
															<td>{signal.signalType}</td>
															<td>{signal.evidence ?? '—'}</td>
															<td>{signal.weight}</td>
														</tr>
													))}
												</tbody>
											</table>
										</td>
									</tr>
								)}
							</>
						))}
					</tbody>
				</table>
			)}
		</>
	);
}
