import { useState } from 'react';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link HtmlPreview}. */
export interface HtmlPreviewProps {
	/** The stored HTML source. */
	html: string;
	/** Whether the HTML was truncated. */
	truncated: boolean;
}

/** Preview display mode. */
type PreviewMode = 'render' | 'source';

/**
 * Displays a page's stored HTML snapshot, toggling between a sandboxed
 * rendered view and the raw source.
 *
 * The rendered view uses an iframe with an empty `sandbox` (no
 * `allow-same-origin`, no `allow-scripts`): scripts and network access are
 * blocked, so even local snapshots render safely.
 * @param props - The HTML source and truncation flag.
 * @returns The preview element.
 */
export function HtmlPreview(props: HtmlPreviewProps) {
	const { html, truncated } = props;
	const { t } = useI18n();
	const [mode, setMode] = useState<PreviewMode>('render');

	return (
		<div className="html-preview">
			<div className="hp-toolbar">
				<button
					type="button"
					className={mode === 'render' ? 'hp-tab hp-tab-active' : 'hp-tab'}
					onClick={() => {
						setMode('render');
					}}>
					{t('common.render')}
				</button>
				<button
					type="button"
					className={mode === 'source' ? 'hp-tab hp-tab-active' : 'hp-tab'}
					onClick={() => {
						setMode('source');
					}}>
					{t('common.source')}
				</button>
				{truncated && <span className="hp-truncated">{t('common.truncated')}</span>}
			</div>
			{mode === 'render' ? (
				<iframe
					className="hp-frame"
					sandbox=""
					srcDoc={html}
					title={t('views.pageDetail.htmlSnapshot')}
				/>
			) : (
				<pre className="hp-source">{html}</pre>
			)}
		</div>
	);
}
