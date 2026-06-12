import type { DuplicateField } from '../api/use-duplicates.js';

import { useSearchParams } from 'react-router';

import { useDuplicates } from '../api/use-duplicates.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The duplicates view: groups of pages sharing the same title or description.
 * @returns The duplicates view element.
 */
export function DuplicatesView() {
	const [params, setParams] = useSearchParams();
	const { t } = useI18n();
	const field = (params.get('field') as DuplicateField | null) ?? 'title';
	const { data, isLoading, error } = useDuplicates(field);

	return (
		<div>
			<ViewHeader
				titleKey="views.duplicates.title"
				descriptionKey="views.duplicates.description"
			/>
			<div className="filter-bar">
				<select
					aria-label={t('common.field')}
					value={field}
					onChange={(e) => {
						const next = new URLSearchParams(params);
						next.set('field', e.target.value);
						setParams(next);
					}}>
					<option value="title">{t('fields.title')}</option>
					<option value="description">{t('fields.description')}</option>
				</select>
			</div>
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{error && <div className="state state-error">{error.message}</div>}
			{data?.length === 0 && <div className="state">{t('views.duplicates.empty')}</div>}
			{data?.map((group) => (
				<div key={group.value} className="card" style={{ marginBottom: 12, minWidth: 0 }}>
					<div className="card-label">
						{t('views.duplicates.share', {
							count: group.count,
							field: t(`fields.${group.field}`),
						})}
					</div>
					<div style={{ fontWeight: 600, margin: '4px 0' }}>
						{group.value || '(empty)'}
					</div>
					<ul>
						{group.urls.slice(0, 50).map((url) => (
							<li key={url}>{url}</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}
