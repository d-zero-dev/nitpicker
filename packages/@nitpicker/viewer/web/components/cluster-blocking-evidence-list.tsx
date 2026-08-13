import type { TemplateClusterReasonSummary } from '@nitpicker/query';

import { getBlockingKindLabel } from '../i18n/get-blocking-kind-label.js';
import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link ClusterBlockingEvidenceList}. */
export interface ClusterBlockingEvidenceListProps {
	/** The reason's Pass-0 blocking evidence (`reason.blocking`). */
	blocking: TemplateClusterReasonSummary['blocking'];
}

/**
 * Renders the `@d-zero/page-cluster` blocking-key evidence for one cluster's
 * reason: which Pass-0 block(s) formed it and why (CSS-distinctive stylesheet
 * set or path-derived key).
 *
 * Always renders its `<dt>`/`<dd>` pair — a cluster with a captured `reason`
 * always has at least one blocking entry (the block that seeded it), so an
 * empty-input guard is not part of this component's contract.
 * @param props - The blocking evidence to render.
 * @returns The `<dt>`/`<dd>` pair element.
 */
export function ClusterBlockingEvidenceList(props: ClusterBlockingEvidenceListProps) {
	const { t } = useI18n();
	const { blocking } = props;
	return (
		<>
			<dt>{t('views.templateClusters.blocking')}</dt>
			<dd>
				<ul>
					{blocking.map((evidence) => (
						<li key={evidence.blockKey}>
							{getBlockingKindLabel(evidence.reason.kind, t)}:{' '}
							<code>
								{evidence.reason.kind === 'css'
									? evidence.reason.distinctiveStylesheetHrefs.join(', ')
									: evidence.reason.pathKey}
							</code>
						</li>
					))}
				</ul>
				<p className="view-description">{t('views.templateClusters.blockingCaveat')}</p>
			</dd>
		</>
	);
}
