import { useUnusedResources } from '../api/use-unused-resources.js';
import { SourceBadge } from '../components/source-badge.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Unused resources view — lists internal sub-resources that no archived
 * page references. The `source` badge on each row tells the operator
 * whether a resource was once referenced and lost its referrers
 * (`crawled`) or was registered straight from the server file list
 * (`inventory-seed`) — useful when deciding what to delete.
 * @returns The unused resources view element.
 */
export function UnusedResourcesView() {
	const { t } = useI18n();
	const { data, isLoading, error } = useUnusedResources();

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
				titleKey="views.unusedResources.title"
				descriptionKey="views.unusedResources.description"
			/>
			<p className="state">{t('views.unusedResources.total', { total: data.total })}</p>
			{data.items.length === 0 ? (
				<div className="state">{t('views.unusedResources.empty')}</div>
			) : (
				<table className="data-table">
					<thead>
						<tr>
							<th>{t('views.unusedResources.url')}</th>
							<th>{t('views.unusedResources.status')}</th>
							<th>{t('views.unusedResources.contentType')}</th>
							<th>{t('views.unusedResources.contentLength')}</th>
							<th>{t('views.unusedResources.source')}</th>
						</tr>
					</thead>
					<tbody>
						{data.items.map((row) => (
							<tr key={row.url}>
								<td>
									<code>{row.url}</code>
								</td>
								<td>{row.status ?? '—'}</td>
								<td>{row.contentType ?? '—'}</td>
								<td>{row.contentLength ?? '—'}</td>
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
