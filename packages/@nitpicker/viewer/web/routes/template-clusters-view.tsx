import type { TemplateClusterSummary } from '@nitpicker/query';

import { Link } from 'react-router';

import { useTemplateClusters } from '../api/use-template-clusters.js';
import { ViewHeader } from '../components/view-header.js';
import { getBlockingKindLabel } from '../i18n/get-blocking-kind-label.js';
import { getLandmarkTypeLabel } from '../i18n/get-landmark-type-label.js';
import { useI18n } from '../i18n/use-i18n.js';
import { formatPercent } from '../utils/format-percent.js';

/** Which source {@link clusterHeading} drew its heading from. */
type ClusterHeadingSource = 'distinctive' | 'common' | 'directory' | 'raw';

/**
 * Builds the human-readable heading for one cluster's section, plus which
 * source it came from (the caller uses this to pick the matching `<summary>`
 * caveat tooltip, so the priority order lives in exactly one place instead
 * of being re-derived independently there).
 *
 * Priority: the reason's distinctive stylesheet filenames (the strongest
 * signal — the exact CSS set `@d-zero/page-cluster` used to blocking-key
 * this cluster, after site-wide-chrome and non-first-party filtering),
 * falling back to the raw common-stylesheet-intersection filenames, then
 * the top directories by page count, and finally the raw template key when
 * nothing else yields anything (an unparseable-URL edge case — see
 * `computeDirectoryDistribution`'s defensive skip).
 *
 * Both stylesheet-based sources can collide across sibling clusters that
 * split off the same blocking group (`reason.siblingClusterKeys`
 * non-empty): `distinctiveStylesheetHrefs` is a **blocking group**'s
 * attribute, not a per-final-cluster one, so it's identical by
 * construction across siblings; `commonStylesheetFileNames` isn't
 * guaranteed identical the same way, but a site-wide-shared stylesheet
 * landing in the raw intersection can still coincide across siblings in
 * practice. Both branches append the top directory to disambiguate when
 * siblings exist.
 *
 * `commonStylesheetFileNames` (dedup'd, filename-only) is precomputed
 * server-side by `@nitpicker/query`'s `computeStylesheetFileNames` rather
 * than derived here — see that function's own JSDoc for why the underlying
 * URL parser can't run in the browser build.
 * @param cluster
 */
function clusterHeading(cluster: TemplateClusterSummary): {
	heading: string;
	source: ClusterHeadingSource;
} {
	const hasSiblings = (cluster.reason?.siblingClusterKeys.length ?? 0) > 0;
	const disambiguated = (base: string) =>
		hasSiblings && cluster.commonDirectories.length > 0
			? `${base} — ${cluster.commonDirectories[0]!.directory}`
			: base;

	const distinctiveNames = cluster.reason?.distinctiveStylesheetFileNames ?? [];
	if (distinctiveNames.length > 0) {
		return { heading: disambiguated(distinctiveNames.join(', ')), source: 'distinctive' };
	}
	if (cluster.commonStylesheetFileNames.length > 0) {
		return {
			heading: disambiguated(cluster.commonStylesheetFileNames.join(', ')),
			source: 'common',
		};
	}
	if (cluster.commonDirectories.length > 0) {
		return {
			heading: cluster.commonDirectories.map((entry) => entry.directory).join(', '),
			source: 'directory',
		};
	}
	return { heading: cluster.templateKey, source: 'raw' };
}

/**
 * Pages not covered by any of the top directories `computeDirectoryDistribution`
 * returned — the count a viewer needs to know the top-N list isn't silently
 * dropping members, without the backend having to send every long-tail
 * directory over the wire.
 * @param cluster
 */
function otherPageCount(cluster: TemplateClusterSummary): number {
	const topCount = cluster.commonDirectories.reduce(
		(sum, entry) => sum + entry.pageCount,
		0,
	);
	return cluster.pageCount - topCount;
}

/**
 * Renders one cluster's `@d-zero/page-cluster` cluster-selection evidence
 * (blocking reason, common DOM structure tokens, common landmarks, sibling
 * clusters), or a "not captured" notice when `cluster.reason` is `null`.
 * @param props - The cluster whose reason (or absence of one) to render, and
 *   the active translate function (from `useI18n()`).
 * @param props.cluster
 * @param props.t
 */
function ClusterReasonSection(props: {
	cluster: TemplateClusterSummary;
	t: ReturnType<typeof useI18n>['t'];
}) {
	const { cluster, t } = props;
	const { reason } = cluster;
	if (!reason) {
		return (
			<div className="state">
				<p>{t('views.templateClusters.noReason')}</p>
				<pre>
					<code>{t('views.templateClusters.noReasonCommandHint')}</code>
				</pre>
			</div>
		);
	}

	const hiddenStructuralCoreCount =
		reason.structuralCoreTokenCount - reason.structuralCoreTokens.length;

	return (
		<dl className="detail-grid">
			<dt>{t('views.templateClusters.blocking')}</dt>
			<dd>
				<ul>
					{reason.blocking.map((evidence) => (
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
			{reason.distinctiveStylesheetUrls.length > 0 && (
				<>
					<dt>{t('views.templateClusters.distinctiveStylesheets')}</dt>
					<dd>
						<ul>
							{reason.distinctiveStylesheetUrls.map((url) => (
								<li key={url}>{url}</li>
							))}
						</ul>
						<p className="view-description">
							{t('views.templateClusters.distinctiveCssCaveat')}
						</p>
					</dd>
				</>
			)}
			<dt>{t('views.templateClusters.structuralCore')}</dt>
			<dd>
				<ul>
					{reason.structuralCoreTokens.map((token) => (
						<li key={token}>
							<code>{token}</code>
						</li>
					))}
				</ul>
				{hiddenStructuralCoreCount > 0 && (
					<p className="view-description">
						{t('views.templateClusters.structuralCoreMore', {
							count: hiddenStructuralCoreCount,
						})}
					</p>
				)}
			</dd>
			{reason.landmarks.length > 0 && (
				<>
					<dt>{t('views.templateClusters.landmarks')}</dt>
					<dd>
						<table>
							<thead>
								<tr>
									<th>{t('views.templateClusters.landmarkColType')}</th>
									<th>{t('views.templateClusters.landmarkColPresence')}</th>
									<th>{t('views.templateClusters.landmarkColChrome')}</th>
									<th>{t('views.templateClusters.landmarkColPages')}</th>
								</tr>
							</thead>
							<tbody>
								{reason.landmarks.map((landmark) => (
									<tr key={landmark.type}>
										<td>{getLandmarkTypeLabel(landmark.type, t)}</td>
										<td>{formatPercent(landmark.presenceRate)}</td>
										<td>{formatPercent(landmark.chromeRate)}</td>
										<td>{landmark.memberCountWithInstance}</td>
									</tr>
								))}
							</tbody>
						</table>
					</dd>
				</>
			)}
			{reason.siblingClusterKeys.length > 0 && (
				<>
					<dt>{t('views.templateClusters.siblings')}</dt>
					<dd>
						<ul>
							{reason.siblingClusterKeys.map((key) => (
								<li key={key}>
									<Link to={`/pages?templateKey=${encodeURIComponent(key)}`}>
										<code>{key}</code>
									</Link>
								</li>
							))}
						</ul>
						<p className="view-description">
							{t('views.templateClusters.siblingsCaveat')}
						</p>
					</dd>
				</>
			)}
		</dl>
	);
}

/**
 * Template cluster analysis: one collapsible section per
 * `page_templates.template_key` cluster, each showing page count, top
 * directories by page count, common stylesheet set computed from the
 * cluster's actual member pages, and (when captured) `@d-zero/page-cluster`'s
 * cluster-selection evidence — the raw key itself is an opaque blocking key
 * and is not human-readable (see `TemplateClusterSummary`'s JSDoc in
 * `@nitpicker/query`).
 * @returns The template clusters view element.
 */
export function TemplateClustersView() {
	const { t } = useI18n();
	const { data, isLoading, error } = useTemplateClusters();

	return (
		<div>
			<ViewHeader
				titleKey="views.templateClusters.title"
				descriptionKey="views.templateClusters.description"
			/>
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{error && <div className="state state-error">{error.message}</div>}
			{data && !data.hasClassification && (
				<div className="state">
					<p>{t('views.templateClusters.notClassified')}</p>
					<pre>
						<code>{t('views.templateClusters.notClassifiedCommandHint')}</code>
					</pre>
				</div>
			)}
			{data && data.hasClassification && data.clusters.length === 0 && (
				<div className="state">{t('views.templateClusters.noClusters')}</div>
			)}
			{data &&
				data.hasClassification &&
				data.clusters.map((cluster) => {
					const { heading, source } = clusterHeading(cluster);
					const title =
						source === 'distinctive'
							? t('views.templateClusters.distinctiveCssCaveat')
							: source === 'common'
								? t('views.templateClusters.commonCssCaveat')
								: undefined;
					return (
						<details key={cluster.templateKey}>
							<summary title={title}>
								{heading} (
								{t('views.templateClusters.pageCount', { count: cluster.pageCount })})
							</summary>
							<dl className="detail-grid">
								<dt>{t('views.templateClusters.commonDirectories')}</dt>
								<dd>
									{cluster.commonDirectories.length > 0 ? (
										<>
											<ul>
												{cluster.commonDirectories.map((entry) => (
													<li key={entry.directory}>
														{entry.directory} (
														{t('views.templateClusters.pageCount', {
															count: entry.pageCount,
														})}
														)
													</li>
												))}
											</ul>
											{otherPageCount(cluster) > 0 && (
												<p className="view-description">
													{t('views.templateClusters.otherPages', {
														count: otherPageCount(cluster),
													})}
												</p>
											)}
										</>
									) : (
										'—'
									)}
								</dd>
								<dt>{t('views.templateClusters.commonStylesheets')}</dt>
								<dd>
									{cluster.commonStylesheetUrls.length > 0 ? (
										<>
											<ul>
												{cluster.commonStylesheetUrls.map((url) => (
													<li key={url}>{url}</li>
												))}
											</ul>
											<p className="view-description">
												{t('views.templateClusters.commonCssCaveat')}
											</p>
										</>
									) : (
										t('views.templateClusters.noCommonCss')
									)}
								</dd>
								<dt>{t('views.templateClusters.rawKey')}</dt>
								<dd>
									<code>{cluster.templateKey}</code>
								</dd>
							</dl>
							<ClusterReasonSection cluster={cluster} t={t} />
							<Link to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
								{t('views.templateClusters.viewPages')}
							</Link>
						</details>
					);
				})}
		</div>
	);
}
