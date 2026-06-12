import { useArchiveInfo } from '../api/use-archive-info.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The footer: shows the absolute path of the source being viewed, plus a
 * mode-dependent badge:
 *
 * - **Archive source**: no badge, label reads "Archive".
 * - **Stub source + live crawler PID**: amber badge "Live crawl in
 *   progress (PID xxx)" — the data is moving under the viewer.
 * - **Stub source, no live crawler**: neutral badge "Interrupted crawl
 *   stub" — read-only fixture of a stopped crawl.
 *
 * The label also switches to "Source" for stub mode so the copy doesn't
 * lie ("Archive" is wrong for a directory).
 * @returns The footer element.
 */
export function Footer() {
	const { t } = useI18n();
	const { data } = useArchiveInfo();
	if (!data) {
		return <footer className="footer" />;
	}
	const label = data.mode === 'stub' ? t('footer.source') : t('footer.archive');
	return (
		<footer className="footer">
			<span>
				{label}: <code className="footer-path">{data.filePath}</code>
				{data.mode === 'stub' && data.crawlerPid !== null && (
					<span
						className="footer-stub-badge footer-stub-badge--live"
						title={t('footer.liveCrawlBadgeTitle')}
						role="status">
						{t('footer.liveCrawlBadge', { pid: String(data.crawlerPid) })}
					</span>
				)}
				{data.mode === 'stub' && data.crawlerPid === null && (
					<span
						className="footer-stub-badge footer-stub-badge--interrupted"
						title={t('footer.interruptedCrawlBadgeTitle')}
						role="status">
						{t('footer.interruptedCrawlBadge')}
					</span>
				)}
			</span>
		</footer>
	);
}
