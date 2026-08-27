import type { Locale } from '../types.js';
import type { SummaryResult } from '@nitpicker/query';
import type { ReactNode } from 'react';

/**
 * One page row in a static HTML report.
 * @example
 * ```ts
 * const page: HtmlReportPage = {
 *   title: 'Example',
 *   url: 'https://example.com/',
 *   status: 200,
 *   redirectChain: [],
 *   metaDescription: 'Example page',
 *   resourceFilesExists: 4,
 *   resourceFilesTotal: 5,
 *   consoleErrorCount: 0,
 * };
 * ```
 */
export interface HtmlReportPage {
	title: string | null;
	url: string;
	status: number | null;
	redirectChain: readonly string[];
	metaDescription: string | null;
	resourceFilesExists: number;
	resourceFilesTotal: number;
	consoleErrorCount: number | null;
}

/**
 * Complete data input for {@link import('./render-html-report.js').renderHtmlReport}.
 * @example
 * ```ts
 * const data: HtmlReportData = {
 *   summary,
 *   pages: [],
 *   locale: 'ja',
 * };
 * ```
 */
export interface HtmlReportData {
	/** Optional document title. */
	title?: string;
	/** Summary data already obtained by the caller. */
	summary: SummaryResult;
	/** Page rows in the exact order in which they should be printed. */
	pages: readonly HtmlReportPage[];
	/** Static report locale. Defaults to Japanese. */
	locale?: Locale;
	/** Optional human-readable generation timestamp. */
	generatedAt?: string;
	/**
	 * Directory prefixes that limited the page table. The summary stays
	 * archive-wide even when this is set. Omitted or empty means the table
	 * lists every inner page.
	 */
	directoryPrefixes?: readonly string[];
}

/**
 * A column definition for {@link import('../components/static-table.js').StaticTable}.
 * @example
 * ```tsx
 * const columns: StaticTableColumn<{ name: string }>[] = [
 *   { key: 'name', label: 'Name', render: (row) => row.name },
 * ];
 * ```
 */
export interface StaticTableColumn<Row> {
	key: string;
	label: string;
	render: (row: Row) => ReactNode;
}
