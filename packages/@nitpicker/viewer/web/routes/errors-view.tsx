import type { ErrorKind } from '@nitpicker/query';

import { useState } from 'react';

import { useErrorKinds } from '../api/use-error-kinds.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';
import { computeRatio } from '../utils/compute-ratio.js';
import { formatPercent } from '../utils/format-percent.js';

/**
 * Errors dashboard: crawl failures grouped by classified cause.
 *
 * Each kind renders as a selectable bar (share of all failure records). The
 * selected kind expands into a per-host breakdown and a list of sample URLs so
 * the user can tell, say, a handful of DNS failures apart from a flood of slow
 * pages that merely timed out — the distinction the raw archive blurs into one
 * "timeout / unknown" bucket. The cause is derived on read, so this works on
 * archives crawled before structured error capture existed.
 * @returns The errors view element.
 */
export function ErrorsView() {
	const { t } = useI18n();
	const { data, isLoading, error } = useErrorKinds();
	const [selected, setSelected] = useState<ErrorKind | null>(null);

	if (isLoading) {
		return <div className="state">{t('common.loading')}</div>;
	}
	if (error) {
		return <div className="state state-error">{error.message}</div>;
	}
	if (!data) {
		return null;
	}

	if (data.total === 0) {
		return (
			<div>
				<ViewHeader
					titleKey="views.errors.title"
					descriptionKey="views.errors.description"
				/>
				<div className="state">{t('views.errors.empty')}</div>
			</div>
		);
	}

	// Default the drill-down to the largest kind so the view is never empty, and
	// fall back to it if a previously-selected kind is absent from the current
	// data (e.g. after a refetch) so the detail panel never silently disappears.
	const activeGroup = data.groups.find((g) => g.kind === selected) ?? data.groups[0];
	const activeKind = activeGroup?.kind ?? null;

	return (
		<div>
			<ViewHeader
				titleKey="views.errors.title"
				descriptionKey="views.errors.description"
			/>
			<p className="state">
				{t('views.errors.total', { total: data.total })}
				{data.channelSource !== 'none' && (
					<>
						{' · '}
						{t('views.errors.channelSource', { source: data.channelSource })}
					</>
				)}
			</p>

			<div className="bars">
				{data.groups.map((group) => {
					const ratio = computeRatio(group.count, data.total);
					const isActive = group.kind === activeKind;
					return (
						<button
							type="button"
							key={group.kind}
							className={isActive ? 'bar-row bar-row-active' : 'bar-row'}
							aria-pressed={isActive}
							onClick={() => setSelected(group.kind)}>
							<span style={{ width: 160, textAlign: 'left' }}>{group.kind}</span>
							<span className="bar-track">
								<span className="bar-fill" style={{ width: `${ratio * 100}%` }} />
							</span>
							<span>
								{group.count.toLocaleString()} <small>({formatPercent(ratio)})</small>
							</span>
						</button>
					);
				})}
			</div>

			{activeGroup && (
				<div className="error-detail">
					<h2>
						{activeGroup.kind} — {t('views.errors.hosts')}
					</h2>
					<div className="bars">
						{activeGroup.hosts.map((host) => (
							<div key={host.host} className="bar-row">
								<span style={{ width: 240, textAlign: 'left' }}>{host.host}</span>
								<span>{host.count.toLocaleString()}</span>
							</div>
						))}
					</div>

					<h2>{t('views.errors.sampleUrls')}</h2>
					{/* Plain, selectable text rather than links: these URLs failed to
					    crawl (DNS failure, refused, cert error, …), so a link would just
					    open a dead tab. They exist to be read and copied for diagnosis. */}
					<ul className="url-list">
						{activeGroup.sampleUrls.map((url, index) => (
							<li key={`${url}-${index}`}>
								<code>{url}</code>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
