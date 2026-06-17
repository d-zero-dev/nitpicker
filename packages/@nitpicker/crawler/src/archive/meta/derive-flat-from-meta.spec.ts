import type {
	LinkMeta,
	Meta,
	OpenGraphMeta,
	RobotsMeta,
	TwitterMeta,
} from '@d-zero/beholder';

import { describe, it, expect } from 'vitest';

import { deriveFlatFromMeta } from './derive-flat-from-meta.js';

const PAGE_URL = 'https://example.com/about';

/**
 * Builds a minimal valid {@link Meta} object with required fields populated.
 * Spec-local helper so each test can spread its own overrides without
 * re-declaring `jsonLd: []`, `tags: { detected: {}, entries: [] }`, etc.
 * @param overrides
 */
function makeMeta(overrides: Partial<Meta> = {}): Meta {
	return {
		title: 'Test',
		jsonLd: [],
		speculationRules: [],
		tags: { detected: {}, entries: [] },
		others: {
			meta: {},
			property: {},
			httpEquiv: {},
			itemprop: {},
			link: [],
			script: [],
			iframe: [],
		},
		originTrial: [],
		...overrides,
	};
}

/**
 * Builds a partial {@link LinkMeta} cast through `unknown`. LinkMeta declares
 * ~50 required arrays; the deriver only reads `canonical`, `amphtml`,
 * `manifest`, `icon`, `appleTouchIcon`. Listing every empty array per test
 * drowns out the intent.
 * @param partial
 */
function linkMeta(partial: Partial<LinkMeta>): LinkMeta {
	return partial as unknown as LinkMeta;
}

/**
 * Same shortcut for {@link OpenGraphMeta} (declares required `image`,
 * `localeAlternate`, `video`, `audio` arrays even when we only care about
 * scalar fields).
 * @param partial
 */
function ogMeta(partial: Partial<OpenGraphMeta>): OpenGraphMeta {
	return partial as unknown as OpenGraphMeta;
}

describe('deriveFlatFromMeta', () => {
	it('returns null for every column when only required Meta fields are present', () => {
		const result = deriveFlatFromMeta(makeMeta(), PAGE_URL);
		expect(result.title).toBe('Test');
		expect(result.lang).toBeNull();
		expect(result.canonical).toBeNull();
		expect(result.og_title).toBeNull();
		expect(result.robots_noindex).toBeNull();
		expect(result.formatDetection_telephone).toBeNull();
	});

	it('copies plain string fields through trimmed', () => {
		const result = deriveFlatFromMeta(
			makeMeta({
				lang: 'ja',
				dir: 'ltr',
				// eslint-disable-next-line unicorn/text-encoding-identifier-case -- HTML5 attribute value is canonically 'utf-8'.
				charset: 'utf-8',
				description: '  spaced  ',
				keywords: 'foo, bar',
				themeColor: '#ffffff',
				applicationName: 'App',
				author: 'Yusuke',
				generator: 'Hugo 1.0',
				publisher: 'Acme',
			}),
			PAGE_URL,
		);
		expect(result.lang).toBe('ja');
		expect(result.description).toBe('spaced');
		expect(result.keywords).toBe('foo, bar');
		expect(result.publisher).toBe('Acme');
	});

	it('maps empty / whitespace strings to null', () => {
		const result = deriveFlatFromMeta(
			makeMeta({ lang: '', description: '   ', keywords: '' }),
			PAGE_URL,
		);
		expect(result.lang).toBeNull();
		expect(result.description).toBeNull();
		expect(result.keywords).toBeNull();
	});

	it('extracts nested og.* fields including the first og:image', () => {
		const result = deriveFlatFromMeta(
			makeMeta({
				og: ogMeta({
					type: 'article',
					title: 'OG Title',
					url: 'https://example.com/about',
					siteName: 'Example',
					description: 'desc',
					image: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
					imageAlt: 'alt',
					imageWidth: '1200',
					imageHeight: '630',
					locale: 'ja_JP',
					article: {
						publishedTime: '2026-01-01T00:00:00Z',
						modifiedTime: '2026-02-01T00:00:00Z',
						author: [],
						tag: [],
					},
				}),
			}),
			PAGE_URL,
		);
		expect(result.og_type).toBe('article');
		expect(result.og_title).toBe('OG Title');
		expect(result.og_image).toBe('https://cdn.example.com/a.png');
		expect(result.og_image_alt).toBe('alt');
		expect(result.og_image_width).toBe('1200');
		expect(result.og_locale).toBe('ja_JP');
		expect(result.og_article_published_time).toBe('2026-01-01T00:00:00Z');
		expect(result.og_article_modified_time).toBe('2026-02-01T00:00:00Z');
	});

	it('prefers og.imageUrl over og.image[0] when both are present', () => {
		const result = deriveFlatFromMeta(
			makeMeta({
				og: ogMeta({
					imageUrl: 'https://cdn.example.com/preferred.png',
					image: ['https://cdn.example.com/fallback.png'],
				}),
			}),
			PAGE_URL,
		);
		expect(result.og_image).toBe('https://cdn.example.com/preferred.png');
	});

	it('maps robots flags to 0/1 integers and leaves missing flags as null', () => {
		const robots: RobotsMeta = {
			raw: 'noindex, nofollow',
			noindex: true,
			nofollow: true,
		};
		const result = deriveFlatFromMeta(makeMeta({ robots }), PAGE_URL);
		expect(result.robots_raw).toBe('noindex, nofollow');
		expect(result.robots_noindex).toBe(1);
		expect(result.robots_nofollow).toBe(1);
		expect(result.robots_noarchive).toBeNull();
		expect(result.robots_noimageindex).toBeNull();
	});

	it('absolutises relative canonical URLs against the page URL', () => {
		const result = deriveFlatFromMeta(
			makeMeta({ link: linkMeta({ canonical: '/about' }) }),
			PAGE_URL,
		);
		expect(result.canonical).toBe('https://example.com/about');
	});

	it('preserves already-absolute canonical URLs unchanged', () => {
		const result = deriveFlatFromMeta(
			makeMeta({ link: linkMeta({ canonical: 'https://example.com/canonical' }) }),
			PAGE_URL,
		);
		expect(result.canonical).toBe('https://example.com/canonical');
	});

	it('resolves URLs against baseHref when present', () => {
		const result = deriveFlatFromMeta(
			makeMeta({
				baseHref: 'https://cdn.example.com/',
				og: ogMeta({ image: ['image.png'] }),
			}),
			PAGE_URL,
		);
		expect(result.og_image).toBe('https://cdn.example.com/image.png');
		expect(result.baseHref).toBe('https://cdn.example.com/');
	});

	it('returns null when a URL is malformed', () => {
		const result = deriveFlatFromMeta(
			makeMeta({ link: linkMeta({ canonical: 'http://[malformed' }) }),
			PAGE_URL,
		);
		expect(result.canonical).toBeNull();
	});

	it('extracts twitter fields including image fallback to imageSrc', () => {
		const twitter: TwitterMeta = {
			card: 'summary_large_image',
			site: '@example',
			creator: '@yusuke',
			title: 'T Title',
			description: 'T Desc',
			imageSrc: 'https://example.com/twitter-image.png',
		};
		const result = deriveFlatFromMeta(makeMeta({ twitter }), PAGE_URL);
		expect(result.twitter_card).toBe('summary_large_image');
		expect(result.twitter_site).toBe('@example');
		expect(result.twitter_creator).toBe('@yusuke');
		expect(result.twitter_image).toBe('https://example.com/twitter-image.png');
	});

	it('extracts fb_app_id / verification_google / formatDetection_telephone', () => {
		const result = deriveFlatFromMeta(
			makeMeta({
				fb: { appId: '123', admins: [], pages: [] },
				verification: { google: 'token-abc' },
				formatDetection: { raw: 'telephone=no', telephone: false },
			}),
			PAGE_URL,
		);
		expect(result.fb_app_id).toBe('123');
		expect(result.verification_google).toBe('token-abc');
		expect(result.formatDetection_telephone).toBe(0);
	});

	it('extracts icon_href / appleTouchIcon_href from link.icon / link.appleTouchIcon', () => {
		const result = deriveFlatFromMeta(
			makeMeta({
				link: linkMeta({
					icon: { href: '/favicon.ico', rel: ['icon'] },
					appleTouchIcon: { href: '/apple-touch-icon.png', rel: ['apple-touch-icon'] },
				}),
			}),
			PAGE_URL,
		);
		expect(result.icon_href).toBe('https://example.com/favicon.ico');
		expect(result.appleTouchIcon_href).toBe('https://example.com/apple-touch-icon.png');
	});
});
