import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { useDedupeCapEvents } from '../api/use-dedupe-cap-events.js';
import { AppLink } from '../components/app-link.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Scrolls the event named by the URL fragment (`#event-<id>`, set by
 * page-detail's "View in Crawl Suppression" link) into view once the event
 * list has loaded. A closed `<details>` element still receives
 * `scrollIntoView`, but browsers do not auto-expand it — `open` on the
 * matching `<details>` (set via a `data-*`-free direct id lookup below)
 * handles that half.
 * @param hash - `location.hash`, including the leading `#`.
 * @param ready - Whether the event list has finished loading (scrolling
 *   before then would target a not-yet-rendered element).
 */
function useScrollToFragmentEvent(hash: string, ready: boolean): void {
	useEffect(() => {
		if (!hash || !ready) return;
		const id = hash.slice(1);
		const el = document.getElementById(id);
		if (el instanceof HTMLDetailsElement) {
			el.open = true;
			el.scrollIntoView({ block: 'start' });
		}
	}, [hash, ready]);
}

/**
 * Formats a `body_hash` for compact display: the first 8 hex characters
 * plus an ellipsis, with the full hash available via the `title` attribute
 * for copy/paste — mirrors the issue's `b328c843…` mockup. `null` (the page
 * had no rendered body at cap time) renders as an em dash.
 * @param bodyHash - The 64-char hex hash, or `null`.
 * @returns The `{ text, title }` pair to spread onto a `<code>` element.
 */
function formatBodyHash(bodyHash: string | null): {
	text: string;
	title: string | undefined;
} {
	if (bodyHash === null) {
		return { text: '—', title: undefined };
	}
	return { text: `${bodyHash.slice(0, 8)}…`, title: bodyHash };
}

/**
 * Crawl Suppression view: surfaces `dedupe_cap_events` (the opt-in
 * `--dedupe-cap` crawl flag's audit log, issue #208) as the human-facing
 * report of "where did the crawler stop, and why."
 *
 * The body_hash-cluster analysis (`listDuplicateBodyClusters`) is
 * deliberately not shown here — its detection axis (masked-body-hash
 * equality) does not reliably catch the same traps `--dedupe-cap` does, so
 * it remains available via the query API / CLI / MCP for post-hoc
 * investigation of duplicates `--dedupe-cap` structurally cannot catch
 * (mirror pages, template accidents), not as a human-facing viewer report.
 * @returns The crawl suppression view element.
 */
export function CrawlSuppressionView() {
	const { t } = useI18n();
	const { data, isLoading, isFetching, error } = useDedupeCapEvents();
	const location = useLocation();
	useScrollToFragmentEvent(location.hash, data != null);

	return (
		<div>
			<ViewHeader
				titleKey="views.crawlSuppression.title"
				descriptionKey="views.crawlSuppression.description"
			/>
			<div role="status" aria-live="polite" aria-busy={isLoading || isFetching}>
				{isLoading && <div className="state">{t('common.loading')}</div>}
				{error && <div className="state state-error">{error.message}</div>}
				{data && data.total === 0 && (
					<div className="state">{t('views.crawlSuppression.noEvents')}</div>
				)}
				{data && data.total > 0 && (
					<p>{t('views.crawlSuppression.lead', { count: data.total })}</p>
				)}
			</div>
			{data?.items.map((event) => {
				const bodyHash = formatBodyHash(event.body_hash);
				return (
					<details key={event.id} id={`event-${event.id}`}>
						<summary>{event.shape_key}</summary>
						<dl className="detail-grid">
							<dt>{t('views.crawlSuppression.detectedAt')}</dt>
							<dd>{new Date(event.detected_at).toLocaleString()}</dd>
							<dt>{t('views.crawlSuppression.capturedPageCountLabel')}</dt>
							<dd>
								{t('views.crawlSuppression.capturedPageCount', {
									count: event.captured_page_count,
								})}
								{event.captured_page_count > 0 && (
									<>
										{' '}
										<AppLink to={`/pages?dedupeCapEventId=${event.id}`}>
											{t('views.crawlSuppression.viewPages')}
										</AppLink>
									</>
								)}
							</dd>
							<dt>{t('views.crawlSuppression.rejectedCount')}</dt>
							<dd>
								{event.rejected_count == null
									? t('views.crawlSuppression.rejectedCountUnknown')
									: event.rejected_count.toLocaleString()}
							</dd>
							<dt>{t('views.crawlSuppression.sampleUrl')}</dt>
							<dd>
								{event.sample_url_archived ? (
									<AppLink
										to={`/pages/detail?url=${encodeURIComponent(event.sample_url)}`}>
										{event.sample_url}
									</AppLink>
								) : (
									event.sample_url
								)}
							</dd>
						</dl>
						<details>
							<summary>{t('views.crawlSuppression.technicalDetails')}</summary>
							<dl className="detail-grid">
								<dt>{t('views.crawlSuppression.effectiveThreshold')}</dt>
								<dd>{event.effective_threshold.toLocaleString()}</dd>
								<dt>{t('views.crawlSuppression.observedCount')}</dt>
								<dd>{event.observed_count.toLocaleString()}</dd>
								<dt>{t('views.crawlSuppression.bodyHash')}</dt>
								<dd>
									<code title={bodyHash.title}>{bodyHash.text}</code>
								</dd>
							</dl>
						</details>
					</details>
				);
			})}
		</div>
	);
}
