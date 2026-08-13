import type { PageConsoleLogEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link ConsoleLogsList}. */
export interface ConsoleLogsListProps {
	/** Console messages / page errors captured on this page, in capture order. */
	entries: readonly PageConsoleLogEntry[];
}

/**
 * Console-log entries captured on this page during crawl, with source
 * location when available.
 * @param props - The captured console-log entries.
 * @returns The console-logs section, or `null` when there are none.
 */
export function ConsoleLogsList(props: ConsoleLogsListProps) {
	const { t } = useI18n();
	const { entries } = props;
	if (entries.length === 0) {
		return null;
	}
	return (
		<>
			<h2>
				{t('views.pageDetail.consoleLogs')} ({entries.length})
			</h2>
			<ul>
				{entries.map((entry, index) => (
					<li key={index}>
						<span className="state">[{entry.type}]</span>{' '}
						{new Date(entry.ts).toLocaleString()} — {entry.text}
						{entry.locationUrl && (
							<span className="state">
								{' '}
								({entry.locationUrl}
								{entry.locationLine == null ? '' : `:${entry.locationLine}`})
							</span>
						)}
					</li>
				))}
			</ul>
		</>
	);
}
