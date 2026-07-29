import type {
	TemplateClusterBlockingEntry,
	TemplateClusterLandmarkType,
	TemplateClusterSummary,
} from '@nitpicker/query';

import { Link } from 'react-router';

import { useTemplateClusters } from '../api/use-template-clusters.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/** Stable display order for landmark types — matches `extract-landmarks`'s DOM-scan order. */
const LANDMARK_TYPE_ORDER: TemplateClusterLandmarkType[] = [
	'header',
	'footer',
	'nav',
	'aside',
	'form',
	'search',
];

/**
 * Builds the human-readable heading for one cluster's section: the common
 * stylesheet filenames when there are any (the strongest signal for "what
 * this template is"), falling back to the top directories by page count,
 * and finally to the raw template key when neither yields anything (an
 * unparseable-URL edge case — see `computeDirectoryDistribution`'s
 * defensive skip).
 *
 * `commonStylesheetFileNames` (dedup'd, filename-only) is precomputed
 * server-side by `@nitpicker/query`'s `computeStylesheetFileNames` rather
 * than derived here — see that function's own JSDoc for why the underlying
 * URL parser can't run in the browser build.
 * @param cluster
 */
function clusterHeading(cluster: TemplateClusterSummary): string {
	if (cluster.commonStylesheetFileNames.length > 0) {
		return cluster.commonStylesheetFileNames.join(', ');
	}
	if (cluster.commonDirectories.length > 0) {
		return cluster.commonDirectories.map((entry) => entry.directory).join(', ');
	}
	return cluster.templateKey;
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
 * The in-page anchor id for a cluster's `<details>` section, used to link
 * `siblingClusterKeys` between sections. `encodeURIComponent`-wrapped since
 * a `templateKey` is a JSON-stringified array (e.g. `["css:abc","cluster:0"]`)
 * containing characters an `id`/fragment round-trip should not be trusted to
 * preserve verbatim.
 * @param templateKey
 */
function clusterAnchorId(templateKey: string): string {
	return `cluster-${encodeURIComponent(templateKey)}`;
}

/**
 * Renders one Pass-0 blocking entry's evidence — which signal
 * `@d-zero/page-cluster` used to group this block, in the caller's chosen
 * i18n strings (page-cluster itself carries no human-readable text, per
 * `TemplateClusterBlockingReason`'s JSDoc in `@nitpicker/query`).
 * @param entry
 * @param t
 */
function renderBlockingEntry(
	entry: TemplateClusterBlockingEntry,
	t: (key: string, params?: Record<string, string | number>) => string,
) {
	const { reason } = entry;
	if (reason.kind === 'css') {
		return (
			<>
				{t('views.templateClusters.blockingKindCss')}
				<ul>
					{reason.distinctiveStylesheetHrefs.map((href) => (
						<li key={href}>{href}</li>
					))}
				</ul>
			</>
		);
	}
	const label =
		reason.kind === 'path'
			? t('views.templateClusters.blockingKindPath')
			: t('views.templateClusters.blockingKindOrphanMerge');
	return (
		<>
			{label}: <code>{reason.pathKey}</code>
		</>
	);
}

/**
 * Template cluster analysis: one collapsible section per
 * `page_templates.template_key` cluster, each showing page count, top
 * directories by page count, and — when available — the `ClusterReason`
 * `@d-zero/page-cluster` reported when it classified the cluster (blocking
 * evidence, DOM-structural core tokens, landmark chrome commonality, sibling
 * clusters) — the raw key itself is an opaque blocking key and is not
 * human-readable (see `TemplateClusterSummary`'s JSDoc in `@nitpicker/query`).
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
				data.clusters.map((cluster) => (
					<details key={cluster.templateKey} id={clusterAnchorId(cluster.templateKey)}>
						<summary>
							{clusterHeading(cluster)} (
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
							<dt>{t('views.templateClusters.rawKey')}</dt>
							<dd>
								<code>{cluster.templateKey}</code>
							</dd>
							<dt>{t('views.templateClusters.reasonTitle')}</dt>
							<dd>
								{cluster.reason ? (
									<dl className="detail-grid">
										<dt>{t('views.templateClusters.blockingTitle')}</dt>
										<dd>
											<ul>
												{cluster.reason.blocking.map((entry) => (
													<li key={entry.blockKey}>{renderBlockingEntry(entry, t)}</li>
												))}
											</ul>
										</dd>
										<dt>{t('views.templateClusters.structuralCoreTokensTitle')}</dt>
										<dd>
											{cluster.reason.structuralCoreTokens.length > 0 ? (
												<ul>
													{cluster.reason.structuralCoreTokens.map((token) => (
														<li key={token}>
															<code>{token}</code>
														</li>
													))}
												</ul>
											) : (
												'—'
											)}
										</dd>
										<dt>{t('views.templateClusters.landmarksTitle')}</dt>
										<dd>
											{LANDMARK_TYPE_ORDER.some(
												(type) => cluster.reason?.landmarks[type],
											) ? (
												<ul>
													{LANDMARK_TYPE_ORDER.map((type) => {
														const profile = cluster.reason?.landmarks[type];
														if (!profile) {
															return null;
														}
														return (
															<li key={type}>
																{t(`views.templateClusters.landmarkTypes.${type}`)}
																{' — '}
																{t('views.templateClusters.landmarkPresenceRate')}:{' '}
																{Math.round(profile.presenceRate * 100)}%,{' '}
																{t('views.templateClusters.landmarkChromeRate')}:{' '}
																{Math.round(profile.chromeRate * 100)}%
																{profile.shellTokens.length > 0 && (
																	<>
																		{' '}
																		({t(
																			'views.templateClusters.landmarkShellTokens',
																		)}: {profile.shellTokens.join(', ')})
																	</>
																)}
															</li>
														);
													})}
												</ul>
											) : (
												'—'
											)}
										</dd>
										<dt>{t('views.templateClusters.siblingClusterKeysTitle')}</dt>
										<dd>
											{cluster.reason.siblingClusterKeys.length > 0 ? (
												<ul>
													{cluster.reason.siblingClusterKeys.map((siblingKey) => (
														<li key={siblingKey}>
															<a href={`#${clusterAnchorId(siblingKey)}`}>{siblingKey}</a>
														</li>
													))}
												</ul>
											) : (
												'—'
											)}
										</dd>
									</dl>
								) : (
									<p className="view-description">
										{t('views.templateClusters.noReason')}
									</p>
								)}
							</dd>
						</dl>
						<Link to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
							{t('views.templateClusters.viewPages')}
						</Link>
					</details>
				))}
		</div>
	);
}
