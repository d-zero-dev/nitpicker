import { useIsolatedPages } from '../api/use-isolated-pages.js';
import { SourceBadge } from '../components/source-badge.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Isolated pages view — lists internal HTML pages that no other page
 * anchors to, excluding archived roots. The `source` badge on each row
 * tells the operator whether a page was discovered by the original
 * crawl (its links went missing later) or supplied via
 * `crawl --inventory` (the URL only exists on the server, never linked).
 * @returns The isolated pages view element.
 */
export function IsolatedPagesView() {
	const { t } = useI18n();
	const { data, isLoading, error } = useIsolatedPages();

	if (isLoading) {
		return <div className="state">{t('common.loading')}</div>;
	}
	if (error) {
		return <div className="state state-error">{error.message}</div>;
	}
	if (!data) {
		return null;
	}

	return (
		<div>
			<ViewHeader
				titleKey="views.isolatedPages.title"
				descriptionKey="views.isolatedPages.description"
			/>
			<p className="state">{t('views.isolatedPages.total', { total: data.total })}</p>
			{data.items.length === 0 ? (
				<div className="state">{t('views.isolatedPages.empty')}</div>
			) : (
				<table className="data-table">
					<thead>
						<tr>
							<th>{t('views.isolatedPages.url')}</th>
							<th>{t('views.isolatedPages.pageTitle')}</th>
							<th>{t('views.isolatedPages.status')}</th>
							<th>{t('views.isolatedPages.source')}</th>
						</tr>
					</thead>
					<tbody>
						{data.items.map((row) => (
							<tr key={row.url}>
								<td>
									<code>{row.url}</code>
								</td>
								<td>{row.title ?? '—'}</td>
								<td>{row.status ?? '—'}</td>
								<td>
									<SourceBadge source={row.source} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
