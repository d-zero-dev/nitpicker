import type { HtmlReportData } from './types.js';

import { describe, expect, it, vi } from 'vitest';

import { renderHtmlReport } from './render-html-report.js';

vi.mock('../styles.css?inline', () => ({
	default: ':root { --bg: #0f1419; }',
}));

const data: HtmlReportData = {
	title: '監査 <結果>',
	locale: 'ja',
	summary: {
		baseUrl: 'https://example.com/',
		roots: ['https://example.com/'],
		maxExcludedDepth: 0,
		excludeKeywords: [],
		excludes: [],
		excludeUrls: [],
		totalPages: 2,
		internalPages: 2,
		externalPages: 0,
		internalContents: 2,
		externalContents: 0,
		statusDistribution: [{ status: 200, count: 2 }],
		metadataFulfillment: {
			title: 1,
			description: 0.5,
			keywords: 0,
			ogTitle: 0,
			ogDescription: 0,
			ogImage: 0,
		},
		contentTypeDistribution: [{ category: 'html', internal: 2, external: 0 }],
		technologyDistribution: [],
		networkOutageAffectedFailures: 0,
		consoleLogCounts: { pageerror: 0, error: 0, warn: 0 },
	},
	pages: [
		{
			title: 'Second',
			url: 'https://example.com/z',
			status: 200,
			redirectChain: [],
			metaDescription: '<unsafe>',
			resourceFilesExists: 3,
			resourceFilesTotal: 4,
			consoleErrorCount: 0,
		},
		{
			title: 'First',
			url: 'https://example.com/a',
			status: 200,
			redirectChain: ['https://example.com/old', 'https://example.com/a'],
			metaDescription: null,
			resourceFilesExists: 1,
			resourceFilesTotal: 1,
			consoleErrorCount: null,
		},
	],
};

describe('renderHtmlReport', () => {
	it('renders standalone localized markup with inline viewer styles', () => {
		const html = renderHtmlReport(data);

		expect(html.startsWith('<!doctype html><html lang="ja">')).toBe(true);
		expect(html).toContain('<style>');
		expect(html).toContain('<th scope="col">リダイレクトチェーン</th>');
		expect(html).toContain('&lt;unsafe&gt;');
		expect(html).not.toContain('<unsafe>');
	});

	it('preserves row order and includes only theme interaction script', () => {
		const html = renderHtmlReport(data);
		const script = html.match(/<script>(.*?)<\/script>/)?.[1];

		expect(html.indexOf('https://example.com/z')).toBeLessThan(
			html.indexOf('https://example.com/a'),
		);
		expect(script).toContain("localStorage.getItem('nitpicker-theme')");
		expect(script).toContain('(prefers-color-scheme: light)');
		expect(script).toContain('document.documentElement.dataset.theme');
		expect(script).not.toContain('.sort(');
	});

	it('notes directory prefixes that limited the page table', () => {
		const html = renderHtmlReport({
			...data,
			directoryPrefixes: ['/docs', 'https://example.com/help'],
		});
		expect(html).toContain(
			'ページ一覧の対象ディレクトリ: /docs, https://example.com/help',
		);
	});

	it('emits a lowercase charset meta and does not turn javascript: URLs into hrefs', () => {
		const html = renderHtmlReport({
			...data,
			pages: [
				{
					title: 'Unsafe',
					url: 'javascript:alert(1)',
					status: 200,
					redirectChain: ['javascript:alert(1)'],
					metaDescription: null,
					resourceFilesExists: 0,
					resourceFilesTotal: 0,
					consoleErrorCount: 0,
				},
			],
		});
		expect(html).toContain('<meta charset="utf-8">');
		expect(html).not.toContain('href="javascript:');
		expect(html).toContain('javascript:alert(1)');
	});

	it('marks missing resources, HTTP 400+ statuses, and console errors in danger text', () => {
		const html = renderHtmlReport({
			...data,
			pages: [
				{
					title: 'Ok',
					url: 'https://example.com/ok',
					status: 200,
					redirectChain: [],
					metaDescription: null,
					resourceFilesExists: 2,
					resourceFilesTotal: 2,
					consoleErrorCount: 0,
				},
				{
					title: 'Problems',
					url: 'https://example.com/bad',
					status: 404,
					redirectChain: [],
					metaDescription: null,
					resourceFilesExists: 1,
					resourceFilesTotal: 3,
					consoleErrorCount: 2,
				},
			],
		});
		expect(html).toContain('<strong class="report-alert">404</strong>');
		expect(html).toContain('<strong class="report-alert">1 / 3</strong>');
		expect(html).toContain('<strong class="report-alert">2</strong>');
		expect(html).not.toContain('<strong class="report-alert">200</strong>');
		expect(html).not.toContain('<strong class="report-alert">2 / 2</strong>');
	});
});
