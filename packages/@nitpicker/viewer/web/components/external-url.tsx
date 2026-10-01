import { useI18n } from '../i18n/use-i18n.js';

import { toHttpHref } from './to-http-href.js';

/**
 * Props for {@link ExternalUrl}.
 */
export interface ExternalUrlProps {
	/** The crawled URL, used as both the link text and the href. */
	readonly url: string;
}

/**
 * Renders a crawled URL as a link to the real URL, opened in a new window and
 * marked with an "open in new window" icon. Falls back to plain text when the
 * URL is not HTTP(S) (`javascript:`, `data:`, relative junk), so a corrupted
 * archive can never produce a followable non-HTTP href.
 *
 * Use it for URLs that have no in-viewer destination. URLs that already
 * navigate to a viewer screen keep their own link (`AppLink` / navigate
 * button) and must not be wrapped in this component.
 * @param props - See {@link ExternalUrlProps}.
 * @returns The link, or the bare URL string when it is not HTTP(S).
 * @example
 * ```tsx
 * <ExternalUrl url="https://example.com/docs" />
 * ```
 */
export function ExternalUrl(props: ExternalUrlProps) {
	const { t } = useI18n();
	const href = toHttpHref(props.url);
	if (!href) {
		return props.url;
	}
	const label = t('common.opensInNewWindow');
	return (
		<a
			className="external-url"
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			title={label}>
			{props.url}
			<svg
				className="external-url-icon"
				viewBox="0 0 24 24"
				width="1em"
				height="1em"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				role="img"
				aria-label={label}>
				<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
			</svg>
		</a>
	);
}
