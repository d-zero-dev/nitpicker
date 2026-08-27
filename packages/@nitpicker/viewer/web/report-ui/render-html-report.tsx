import type { HtmlReportData } from './types.js';

export type { HtmlReportData, HtmlReportPage } from './types.js';

import { renderToStaticMarkup } from 'react-dom/server';

import { HtmlReportDocument } from '../components/html-report-document.js';
import { I18nProvider } from '../i18n/i18n-provider.js';
import viewerStyles from '../styles.css?inline';

const THEME_SCRIPT = `(()=>{let theme;try{theme=localStorage.getItem('nitpicker-theme')}catch{}if(theme!=='dark'&&theme!=='light'){theme=globalThis.matchMedia?.('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=theme;addEventListener('DOMContentLoaded',()=>{const button=document.querySelector('[data-report-theme-toggle]');if(!button)return;const sync=()=>{const dark=document.documentElement.dataset.theme==='dark';button.textContent=dark?'☀':'☾';const label=dark?button.dataset.toLight:button.dataset.toDark;if(label){button.setAttribute('aria-label',label);button.title=label}};sync();button.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('nitpicker-theme',next)}catch{}sync()})})})()`;

/**
 * Renders a complete, standalone HTML report with the viewer stylesheet
 * embedded inline. The returned document performs no data fetching and keeps
 * page rows in caller-provided order.
 * @param data - Prepared summary and page data.
 * @returns A complete HTML document beginning with `<!doctype html>`.
 * @example
 * ```ts
 * import { renderHtmlReport } from '@nitpicker/viewer/report-ui';
 *
 * const html = renderHtmlReport({ summary, pages, locale: 'ja' });
 * ```
 */
export function renderHtmlReport(data: HtmlReportData): string {
	const locale = data.locale ?? 'ja';
	const title =
		data.title ?? (locale === 'ja' ? 'Nitpicker HTML レポート' : 'Nitpicker HTML Report');
	const titleMarkup = renderToStaticMarkup(<title>{title}</title>);
	const bodyMarkup = renderToStaticMarkup(
		<I18nProvider initialLocale={locale}>
			<HtmlReportDocument {...data} title={title} locale={locale} />
		</I18nProvider>,
	);

	return `<!doctype html><html lang="${locale}"><head><meta charSet="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${titleMarkup}<script>${THEME_SCRIPT}</script><style>${viewerStyles}</style></head><body>${bodyMarkup}</body></html>`;
}
