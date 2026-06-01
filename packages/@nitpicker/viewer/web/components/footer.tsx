import { useArchiveInfo } from '../api/use-archive-info.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The footer: shows the absolute path of the `.nitpicker` archive being viewed.
 * @returns The footer element.
 */
export function Footer() {
	const { t } = useI18n();
	const { data } = useArchiveInfo();
	return (
		<footer className="footer">
			{data && (
				<span>
					{t('footer.archive')}: <code className="footer-path">{data.filePath}</code>
				</span>
			)}
		</footer>
	);
}
