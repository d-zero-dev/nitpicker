import type { PageTechnologiesResult } from '../api/use-page-technologies.js';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link TechnologyStarChart}. */
export interface TechnologyStarChartProps {
	data: PageTechnologiesResult | undefined;
	isLoading: boolean;
	error: Error | null;
}

/**
 * A page's detected-technology star chart: every technology detected on the
 * page, confidence descending, each a `<details>` whose body shows the raw
 * signals (evidence) that contributed to it. The details share a `name`, so
 * opening one closes the other.
 * @param props - The page's technologies query result.
 * @returns The technologies section.
 */
export function TechnologyStarChart(props: TechnologyStarChartProps) {
	const { t } = useI18n();
	const { data, isLoading, error } = props;

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
				<div>
					{data.technologies.map((tech) => (
						// `name` makes the group exclusive: opening a technology closes the
						// one that was open, so at most one signals table is shown at a time.
						<details key={tech.technology} name="technology" className="tech-item">
							<summary className="tech-summary">
								<span className="tech-name">{tech.technology}</span>
								<span className="tech-meta">
									<span className="tech-meta-label">
										{t('views.technologies.colCategory')}
									</span>{' '}
									{tech.category ?? '—'}
								</span>
								<span className="tech-meta">
									<span className="tech-meta-label">
										{t('views.pageDetail.colVersion')}
									</span>{' '}
									{tech.version ?? '—'}
								</span>
								<span className="tech-meta">
									<span className="tech-meta-label">
										{t('views.pageDetail.colConfidence')}
									</span>{' '}
									{tech.confidence}
								</span>
								<span className="tech-meta">
									<span className="tech-meta-label">
										{t('views.pageDetail.colSignalCount')}
									</span>{' '}
									{tech.signalCount}
								</span>
							</summary>
							<div className="tech-detail">
								<div className="plain-table-scroll">
									<table className="plain-table">
										<thead>
											<tr>
												<th>{t('views.pageDetail.colSignalType')}</th>
												<th>{t('views.pageDetail.colEvidence')}</th>
												<th className="plain-table-num">
													{t('views.pageDetail.colWeight')}
												</th>
											</tr>
										</thead>
										<tbody>
											{tech.signals.map((signal, index) => (
												<tr key={`${signal.signalType}-${index}`}>
													<td>{signal.signalType}</td>
													<td>{signal.evidence ?? '—'}</td>
													<td className="plain-table-num">{signal.weight}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						</details>
					))}
				</div>
			)}
		</>
	);
}
