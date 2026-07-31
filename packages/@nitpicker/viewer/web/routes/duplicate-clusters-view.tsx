import { useState } from 'react';
import { Link } from 'react-router';

import { useDedupeCapEvents } from '../api/use-dedupe-cap-events.js';
import { useDuplicateClusters } from '../api/use-duplicate-clusters.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';
import { formatPercent } from '../utils/format-percent.js';

const DEFAULT_MIN_COUNT = 10;

/**
 * Same-`body_hash` cluster analysis (issue #208): one collapsible section
 * per cluster, showing size, `og:url` mismatch ratio (a same-cluster-trap
 * indicator — a pager/query-parameter trap's `og:url` typically still
 * points at the parent listing rather than the fake paginated URL), top
 * directories by page count, and a bounded sample of member URLs.
 *
 * Also surfaces a "crawl confirmed N same-cluster traps" notice from
 * `dedupe_cap_events` (the opt-in `--dedupe-cap` crawl flag's audit log) —
 * deliberately folded into this view rather than given its own nav item,
 * matching how `network_outages` backs a notice on the Summary view instead
 * of a standalone page.
 * @returns The duplicate clusters view element.
 */
export function DuplicateClustersView() {
	const { t } = useI18n();
	const [minCount, setMinCount] = useState(DEFAULT_MIN_COUNT);
	const { data: clusters, isLoading, error } = useDuplicateClusters({ minCount });
	const { data: capEvents } = useDedupeCapEvents();

	return (
		<div>
			<ViewHeader
				titleKey="views.duplicateClusters.title"
				descriptionKey="views.duplicateClusters.description"
			/>
			{capEvents && capEvents.total > 0 && (
				<div className="state">
					{t('views.duplicateClusters.capNotice', { count: capEvents.total })}
				</div>
			)}
			<label>
				{t('views.duplicateClusters.minCountLabel')}
				<input
					type="number"
					min={2}
					value={minCount}
					onChange={(e) => setMinCount(Number(e.target.value) || DEFAULT_MIN_COUNT)}
				/>
			</label>
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{error && <div className="state state-error">{error.message}</div>}
			{clusters && clusters.length === 0 && (
				<div className="state">{t('views.duplicateClusters.noClusters')}</div>
			)}
			{clusters?.map((cluster) => (
				<details key={cluster.signature}>
					<summary>
						{t('views.duplicateClusters.clusterHeading', {
							count: cluster.count,
							ratio: formatPercent(cluster.ogUrlMismatchRatio),
						})}
					</summary>
					<dl className="detail-grid">
						<dt>{t('views.duplicateClusters.signature')}</dt>
						<dd>
							<code>{cluster.signature}</code>
						</dd>
						<dt>{t('views.duplicateClusters.ogUrlMismatchRatio')}</dt>
						<dd>{formatPercent(cluster.ogUrlMismatchRatio)}</dd>
						<dt>{t('views.duplicateClusters.commonDirectories')}</dt>
						<dd>
							{cluster.commonDirectories.length > 0 ? (
								<ul>
									{cluster.commonDirectories.map((entry) => (
										<li key={entry.directory}>
											<Link
												to={`/pages?directory=${encodeURIComponent(entry.directory)}`}>
												{entry.directory}
											</Link>{' '}
											(
											{t('views.duplicateClusters.pageCount', { count: entry.pageCount })}
											)
										</li>
									))}
								</ul>
							) : (
								'—'
							)}
						</dd>
						<dt>{t('views.duplicateClusters.samplePages')}</dt>
						<dd>
							<ul>
								{cluster.samplePages.map((url) => (
									<li key={url}>{url}</li>
								))}
							</ul>
							{cluster.count > cluster.samplePages.length && (
								<p className="view-description">
									{t('views.duplicateClusters.otherPages', {
										count: cluster.count - cluster.samplePages.length,
									})}
								</p>
							)}
						</dd>
					</dl>
				</details>
			))}
		</div>
	);
}
