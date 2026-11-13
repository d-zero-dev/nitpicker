import { useState } from 'react';

import { useCommandTarget } from '../hooks/use-command-target.js';
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
	// The tab buttons send `--render` / `--source` to the toolbar.
	const { id: toolbarId, ref: toolbarRef } = useCommandTarget<HTMLDivElement>({
		'--render': () => {
			setMode('render');
		},
		'--source': () => {
			setMode('source');
		},
	});

	return (
		<div className="html-preview">
			<div ref={toolbarRef} id={toolbarId} className="hp-toolbar">
				<button
					type="button"
					className={mode === 'render' ? 'hp-tab hp-tab-active' : 'hp-tab'}
					command="--render"
					commandfor={toolbarId}>
					{t('common.render')}
				</button>
				<button
					type="button"
					className={mode === 'source' ? 'hp-tab hp-tab-active' : 'hp-tab'}
					command="--source"
					commandfor={toolbarId}>
					{t('common.source')}
				</button>
				{truncated && <span className="hp-truncated">{t('common.truncated')}</span>}
			</div>
			{mode === 'render' ? (
				// No `loading="lazy"`: the snapshot is an inline `srcDoc` (no network
				// fetch to defer), and a lazy frame outside the viewport stays empty in
				// screenshots and print. `.markuplintrc.json` exempts `.hp-frame` from
				// `performance/iframe-lazy-loading` for the same reason.
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
