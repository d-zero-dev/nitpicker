import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { headerPresenceExpression } from './header-presence-sql.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_header_presence_sql__');

describe('headerPresenceExpression', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'header-presence-sql-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.10.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://example.com'],
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
		});

		// Real CSP header present.
		await archive.setPage({
			url: parseUrl('https://example.com/with-csp')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: { 'Content-Security-Policy': "default-src 'self'" },
			html: '',
			meta: {
				lang: null,
				title: null,
				description: null,
				keywords: null,
				noindex: false,
				nofollow: false,
				noarchive: false,
				canonical: null,
				alternate: null,
				'og:type': null,
				'og:title': null,
				'og:site_name': null,
				'og:description': null,
				'og:url': null,
				'og:image': null,
				'twitter:card': null,
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// No CSP header, but a *value* mentions "content-security-policy" —
		// must not false-positive on a plain substring match.
		await archive.setPage({
			url: parseUrl('https://example.com/mentions-csp-in-value')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {
				'Referrer-Policy': 'see our content-security-policy docs for details',
			},
			html: '',
			meta: {
				lang: null,
				title: null,
				description: null,
				keywords: null,
				noindex: false,
				nofollow: false,
				noarchive: false,
				canonical: null,
				alternate: null,
				'og:type': null,
				'og:title': null,
				'og:site_name': null,
				'og:description': null,
				'og:url': null,
				'og:image': null,
				'twitter:card': null,
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('evaluates to 1 when the header key is actually present', async () => {
		const knex = archive.getKnex();
		const rows = await knex('pages')
			.where('url', 'https://example.com/with-csp')
			.select(knex.raw(`${headerPresenceExpression('hasCSP')} as "hasCSP"`));
		expect(Number(rows[0].hasCSP)).toBe(1);
	});

	it('evaluates to 0 when the header name only appears inside another header value', async () => {
		const knex = archive.getKnex();
		const rows = await knex('pages')
			.where('url', 'https://example.com/mentions-csp-in-value')
			.select(knex.raw(`${headerPresenceExpression('hasCSP')} as "hasCSP"`));
		expect(Number(rows[0].hasCSP)).toBe(0);
	});
});
