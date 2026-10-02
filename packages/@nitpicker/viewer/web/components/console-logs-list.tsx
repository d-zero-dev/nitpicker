import type { PageConsoleLogEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

import { ConsoleLogType } from './console-log-type.js';
import { ExternalUrl } from './external-url.js';

/** Props for {@link ConsoleLogsList}. */
export interface ConsoleLogsListProps {
	/** Console messages / page errors captured on this page, in capture order. */
	entries: readonly PageConsoleLogEntry[];
}

/**
 * Console-log entries captured on this page during crawl, as a table: the
 * message type as a colored badge, when it was captured, the message, and
 * its source location when available.
 * @param props - The captured console-log entries.
 * @returns The console-logs section, or `null` when there are none.
 * @example
 * <ConsoleLogsList entries={data.consoleLogs} />
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
			<div className="plain-table-scroll">
				<table className="plain-table">
					<thead>
						<tr>
							<th className="plain-table-nowrap">{t('views.consoleLogs.colType')}</th>
							<th className="plain-table-nowrap">{t('views.consoleLogs.colTime')}</th>
							<th>{t('views.consoleLogs.colText')}</th>
							<th>{t('views.consoleLogs.colLocation')}</th>
						</tr>
					</thead>
					<tbody>
						{entries.map((entry, index) => (
							<tr key={index}>
								<td className="plain-table-nowrap">
									<ConsoleLogType type={entry.type} />
								</td>
								<td className="plain-table-nowrap">
									{new Date(entry.ts).toLocaleString()}
								</td>
								<td>
									<div className="plain-table-prose">{entry.text}</div>
								</td>
								<td>
									{entry.locationUrl ? (
										<>
											<ExternalUrl url={entry.locationUrl} />
											{entry.locationLine == null ? '' : `:${entry.locationLine}`}
										</>
									) : (
										t('common.none')
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}
