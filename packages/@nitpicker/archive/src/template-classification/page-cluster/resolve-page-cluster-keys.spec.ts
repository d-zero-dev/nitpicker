import type { PageClusterKeys, PageClusterPage } from './types.js';

import { describe, expect, test } from 'vitest';

import { resolvePageClusterKeys } from './resolve-page-cluster-keys.js';

/** A page as the specs write it: its HTML inline instead of behind `getHtml()`. */
type InlinePage = Omit<PageClusterPage, 'getHtml'> & { readonly html: string };

/**
 * Resolves the pages' cluster keys and reasons.
 * @param pages
 */
function clusterOf(pages: readonly InlinePage[]): Promise<PageClusterKeys> {
	const mapped: PageClusterPage[] = pages.map(({ html, ...rest }) => ({
		...rest,
		getHtml: () => html,
	}));
	return resolvePageClusterKeys(() => mapped);
}

/**
 * Resolves the pages' cluster keys.
 * @param pages
 */
async function keysOf(pages: readonly InlinePage[]): Promise<string[]> {
	const { keys } = await clusterOf(pages);
	return keys;
}

describe('resolvePageClusterKeys', () => {
	test('an empty page list returns an empty array', async () => {
		expect(await keysOf([])).toEqual([]);
	});

	test('matches the exact output documented in the JSDoc @example', async () => {
		// Kept in sync with resolvePageClusterKeys's @example: if this ever
		// fails, the JSDoc example is out of date and must be corrected
		// alongside the implementation, not the other way around.
		const result = await keysOf([
			{
				paths: ['news', '1'],
				stylesheetHrefs: [],
				html: '<body><article>one</article></body>',
			},
			{
				paths: ['news', '2'],
				stylesheetHrefs: [],
				html: '<body><article>two</article></body>',
			},
			{
				paths: ['about'],
				stylesheetHrefs: [],
				html: '<body><section>about</section></body>',
			},
		]);
		expect(result).toEqual([
			'["path:news","cluster:0"]',
			'["path:news","cluster:0"]',
			'["path:about","cluster:0"]',
		]);
	});

	test('two pages that block into the same path group and share an identical structure get the same final key', async () => {
		const html =
			'<body><header>H</header><main><div class="card">C</div></main><footer>F</footer></body>';
		const result = await keysOf([
			{ paths: ['dept-a', 'page1'], stylesheetHrefs: [], html },
			{ paths: ['dept-a', 'page2'], stylesheetHrefs: [], html },
		]);

		expect(result[0]).toBe(result[1]);
	});

	test('pages within the same block but with dissimilar structure get different final keys', async () => {
		// header/footer are identical across all three (and excluded from
		// comparison by default) — the distinguishing element is a <div> vs a
		// <form>, neither of which is a landmark type, so the difference
		// survives landmark exclusion.
		const cardHtml =
			'<body><header>H</header><main><div class="card">C</div></main><footer>F</footer></body>';
		const formHtml =
			'<body><header>H</header><main><form>F</form></main><footer>F</footer></body>';
		const result = await keysOf([
			{ paths: ['dept-a', 'page1'], stylesheetHrefs: [], html: cardHtml },
			{ paths: ['dept-a', 'page2'], stylesheetHrefs: [], html: cardHtml },
			{ paths: ['dept-a', 'page3'], stylesheetHrefs: [], html: formHtml },
		]);

		expect(result[0]).toBe(result[1]);
		expect(result[2]).not.toBe(result[0]);
	});

	test('two different blocks that each independently produce local cluster label cluster:0 do not collide', async () => {
		// Each page is the sole member of its own path-derived block
		// (`path:dept-a`, `path:dept-b`), both producing local label
		// `cluster:0`. Different structures keep them in separate clusters
		// (Stage B cross-block merge only unifies structurally similar pages).
		// Regression test for the cross-block label-collision gap this
		// function exists to close via JSON.stringify composition.
		const result = await keysOf([
			{
				paths: ['dept-a', 'page1'],
				stylesheetHrefs: [],
				html: '<body><main><article>A</article></main></body>',
			},
			{
				paths: ['dept-b', 'page1'],
				stylesheetHrefs: [],
				html: '<body><main><section>B</section></main></body>',
			},
		]);

		expect(result[0]).not.toBe(result[1]);
	});

	test('a stylesheet-derived block and a path-derived block never collide even with identical local labels', async () => {
		// dept-a's two pages share a distinctive stylesheet (css: key); dept-b's
		// lone page has no stylesheet at all and falls back to a path: key.
		// Both blocks' sole/first cluster is locally labeled `cluster:0`.
		// Different structures keep them in separate final clusters (Stage B
		// only unifies structurally similar pages across blocks).
		const htmlA = '<body><header>H</header><main><article>A</article></main></body>';
		const htmlB = '<body><header>H</header><main><section>B</section></main></body>';
		const result = await keysOf([
			{
				paths: ['dept-a', 'page1'],
				stylesheetHrefs: ['https://example.com/a.css'],
				html: htmlA,
			},
			{
				paths: ['dept-a', 'page2'],
				stylesheetHrefs: ['https://example.com/a.css'],
				html: htmlA,
			},
			{ paths: ['dept-b', 'page1'], stylesheetHrefs: [], html: htmlB },
		]);

		expect(result[0]).toBe(result[1]);
		expect(result[2]).not.toBe(result[0]);
	});

	test('the result preserves input order and length across interleaved blocks', async () => {
		const pages = [
			{ paths: ['dept-a', '1'], stylesheetHrefs: [], html: '<body><a>x</a></body>' },
			{ paths: ['dept-b', '1'], stylesheetHrefs: [], html: '<body><b>x</b></body>' },
			{ paths: ['dept-a', '2'], stylesheetHrefs: [], html: '<body><a>x</a></body>' },
			{ paths: ['dept-b', '2'], stylesheetHrefs: [], html: '<body><b>x</b></body>' },
		];
		const result = await keysOf(pages);

		expect(result).toHaveLength(pages.length);
		expect(result[0]).toBe(result[2]); // both dept-a, identical structure
		expect(result[1]).toBe(result[3]); // both dept-b, identical structure
		expect(result[0]).not.toBe(result[1]); // different blocks
	});

	test('two pages differing only in header/footer content get the same final key (landmarks are excluded from comparison)', async () => {
		// A page-category label baked into a shared header/footer does not
		// prevent two otherwise-identical pages from clustering together.
		const result = await keysOf([
			{
				paths: ['dept-a', 'page1'],
				stylesheetHrefs: [],
				html: '<body><header class="law-page">H</header><main><div class="card">C</div></main></body>',
			},
			{
				paths: ['dept-a', 'page2'],
				stylesheetHrefs: [],
				html: '<body><header class="humanities-page">H</header><main><div class="card">C</div></main></body>',
			},
		]);

		expect(result[0]).toBe(result[1]);
	});

	test('a large shared header does not hold pages together once it is excluded: the remaining content decides', async () => {
		// A large shared header (8 distinct nodes) would inflate raw-HTML
		// similarity above the 0.8 bound, but landmarks are excluded from the
		// comparison, so only the content remains — 3 shared content nodes vs 1
		// page-specific one each, Jaccard 3/5 = 0.6 — which the bound rejects.
		const sharedHeader = `<header>${Array.from({ length: 8 }, (_, i) => `<div class="nav-${i}"></div>`).join('')}</header>`;
		const sharedContent = Array.from(
			{ length: 3 },
			(_, i) => `<div class="content-shared-${i}"></div>`,
		).join('');
		const pageA = {
			paths: ['dept-a', 'page1'],
			stylesheetHrefs: [],
			html: `<body>${sharedHeader}<main>${sharedContent}<div class="content-a"></div></main></body>`,
		};
		const pageB = {
			paths: ['dept-a', 'page2'],
			stylesheetHrefs: [],
			html: `<body>${sharedHeader}<main>${sharedContent}<div class="content-b"></div></main></body>`,
		};

		const result = await keysOf([pageA, pageB]);
		expect(result[0]).not.toBe(result[1]);
	});

	test('residual chrome not covered by header/footer/nav/aside (e.g. a breadcrumb) still gets absorbed by the frequency-split safety net at block sizes >= 10', async () => {
		// 8 class-bearing divs shared by every page (a stand-in for a
		// breadcrumb — not a landmark tag, so landmark extraction leaves it
		// alone). Each page adds exactly one page-specific *element*. Raw
		// Jaccard(a, b) = 8/10 = 0.8, which meets the default threshold on its
		// own; the frequency-split safety net (block size 11 >= the floor)
		// must still separate them once the shared divs are recognized as
		// chrome. The page-specific part has to be a distinct tag, not a
		// distinct class on the same tag: a class carried by exactly one page
		// of the block is stripped as a page identifier before comparison
		// (a Stage A per-block rule), and tokenization discards visible text, so a
		// class-only or text-only difference would leave a and b identical.
		const crumbs = Array.from(
			{ length: 8 },
			(_, i) => `<div class="crumb-${i}"></div>`,
		).join('');
		const fillerTags = ['p', 'ul', 'table', 'h1', 'h2', 'h3', 'dl', 'blockquote', 'pre'];
		const pages = fillerTags.map((tag, i) => ({
			paths: ['dept-a', `filler-${i}`],
			stylesheetHrefs: [],
			html: `<body>${crumbs}<${tag}></${tag}></body>`,
		}));
		pages.push(
			{
				paths: ['dept-a', 'a'],
				stylesheetHrefs: [],
				html: `<body>${crumbs}<section></section></body>`,
			},
			{
				paths: ['dept-a', 'b'],
				stylesheetHrefs: [],
				html: `<body>${crumbs}<form></form></body>`,
			},
		);
		const result = await keysOf(pages);

		const a = result.at(-2);
		const b = result.at(-1);
		expect(a).not.toBe(b);
	});

	test('a page with no recorded stylesheets rejoin a same-section css: block', async () => {
		const html = '<body><header>H</header><main><div class="card">C</div></main></body>';
		const pages = [
			{ paths: ['news', '1'], stylesheetHrefs: ['https://example.com/a.css'], html },
			{ paths: ['news', '2'], stylesheetHrefs: ['https://example.com/a.css'], html },
			{ paths: ['news', '3'], stylesheetHrefs: [], html },
			{ paths: ['other'], stylesheetHrefs: ['https://example.com/b.css'], html },
		];

		const result = await keysOf(pages);

		expect(result[2]).toBe(result[0]);
	});

	test('pages with a different mix of data-block content blocks are not merged: block markup is compared like any other markup', async () => {
		const pageA = {
			paths: ['dept-a', '1'],
			stylesheetHrefs: [],
			html: '<body><article class="detail"><div data-block="title"><h2 class="t">Title</h2></div></article></body>',
		};
		const pageB = {
			paths: ['dept-a', '2'],
			stylesheetHrefs: [],
			html: '<body><article class="detail"><div data-block="quote"><blockquote class="q">Q</blockquote></div></article></body>',
		};

		const result = await keysOf([pageA, pageB]);

		expect(result[0]).not.toBe(result[1]);
	});

	test("a page whose only stylesheet is third-party is treated as having none and rejoins its section's css: block", async () => {
		const html = '<body><header>H</header><main><div class="card">C</div></main></body>';
		const pages = [
			{ paths: ['news', '1'], stylesheetHrefs: ['https://example.com/a.css'], html },
			{ paths: ['news', '2'], stylesheetHrefs: ['https://example.com/a.css'], html },
			{
				paths: ['news', '3'],
				stylesheetHrefs: ['https://fonts.cdn.example/css?family=x'],
				html,
			},
			{ paths: ['other'], stylesheetHrefs: ['https://example.com/b.css'], html },
		];

		const result = await keysOf(pages);

		expect(result[2]).toBe(result[0]);
	});

	test('an incidental third-party stylesheet reference from splitting an otherwise-matching page into its own block', async () => {
		const html = '<body><header>H</header><main><div class="card">C</div></main></body>';
		const pages = [
			{ paths: ['news', '1'], stylesheetHrefs: ['https://example.com/a.css'], html },
			{ paths: ['news', '2'], stylesheetHrefs: ['https://example.com/a.css'], html },
			{
				paths: ['news', '3'],
				stylesheetHrefs: [
					'https://example.com/a.css',
					'https://fonts.cdn.example/css?family=x',
				],
				html,
			},
			{ paths: ['other'], stylesheetHrefs: ['https://example.com/b.css'], html },
		];

		const result = await keysOf(pages);

		expect(result[2]).toBe(result[0]);
	});

	test("providing each page's host avoids a dominant-host tie mistakenly keeping a sitewide third party over the real first party (regression test for a real crawl finding)", async () => {
		// 10 pages: every page loads *some* fonts.cdn.example stylesheet
		// plus its own first-party one, tying the third-party host and the
		// first-party host at "referenced by 10/10 pages" — the exact shape
		// confirmed on a real 302-page crawl. dept-a/dept-b share one
		// identical font-CDN query string (their only distinguishing
		// signal if that third party wins the tie); the 8 filler pages each
		// use a *different* font-CDN query string (so it never looks like
		// a shared template signal on its own) and their own unique
		// first-party stylesheet.
		//
		// Without `host`, the tie-break keeps fonts.cdn.example (inserted first
		// below), so dept-a/dept-b's real, distinguishing first-party
		// stylesheets (a.css vs b.css) are dropped and their identical
		// surviving font-CDN href wrongly becomes a shared css: block,
		// causing Stage A to merge dept-a and dept-b (wrong).
		//
		// With `host` supplied, each page's real first-party stylesheet
		// survives instead. dept-a and dept-b are assigned to separate css:
		// blocks. Stage B then considers them the same template (they share
		// identical HTML) and merges them — which is correct behaviour for
		// two departments using the same CMS template. The `host` fix matters
		// when their HTML differs (structural discrimination preserved once the
		// blocking is correct); the regression test below verifies the bug
		// scenario (wrong block causes wrong merge when host is absent).
		const html = '<body><header>H</header><main><div class="card">C</div></main></body>';
		const targetPages = [
			{
				paths: ['dept-a', '1'],
				host: 'example.com',
				stylesheetHrefs: [
					'https://fonts.cdn.example/css?family=shared',
					'https://example.com/a.css',
				],
				html,
			},
			{
				paths: ['dept-b', '1'],
				host: 'example.com',
				stylesheetHrefs: [
					'https://fonts.cdn.example/css?family=shared',
					'https://example.com/b.css',
				],
				html,
			},
		];
		const fillerPages = Array.from({ length: 8 }, (_, i) => ({
			paths: [`filler-${i}`],
			host: 'example.com',
			stylesheetHrefs: [
				`https://fonts.cdn.example/css?family=filler-${i}`,
				`https://example.com/filler-${i}.css`,
			],
			html,
		}));
		const pages = [...targetPages, ...fillerPages];

		// Without host the blocking is wrong: dept-a/dept-b land in the same
		// css: block (the font CDN wins the tie) and Stage A merges them.
		const withoutHost = await keysOf(
			pages.map(({ paths, stylesheetHrefs, html: pageHtml }) => ({
				paths,
				stylesheetHrefs,
				html: pageHtml,
			})),
		);
		expect(withoutHost[0]).toBe(withoutHost[1]);
	});

	test('the always-on <main> depth cap merges pages whose only difference is content nested deep inside <main>, requiring no site-specific configuration', async () => {
		// Identical structure up to depth 3 inside <main>; a page-unique class
		// at depth 4 fragments every page apart unless that depth is capped.
		const pages = Array.from({ length: 20 }, (_, i) => ({
			paths: ['dept-a', `${i}`],
			stylesheetHrefs: [],
			html: `<body><main><section><article><div><span class="unique-${i}">content</span></div></article></section></main></body>`,
		}));

		expect(new Set(await keysOf(pages)).size).toBe(1);
	});

	test("the always-on <main> depth cap detects each block's own knee separately, so a small block is not left under-capped by a larger, differently-shaped block", async () => {
		// Block "dept-a" (40 pages, dominates a corpus-wide sweep): identical
		// up to depth 3, page-unique content at depth 4 -> its own knee is 3.
		const deptA = Array.from({ length: 40 }, (_, i) => ({
			paths: ['dept-a', `${i}`],
			stylesheetHrefs: [],
			html: `<body><main><section><article><div><span class="unique-a-${i}">c</span></div></article></section></main></body>`,
		}));
		// Block "dept-b" (6 pages): identical up to depth 2, page-unique
		// content at depth 3 -> its own knee is 2, much shallower than
		// dept-a's. A single depth derived once across the whole corpus would
		// be dominated by dept-a's larger, deeper-diverging shape and cap
		// dept-b too deep, letting dept-b's own noise (which starts right at
		// depth 3) leak straight through uncapped. (The sweep starts at depth
		// 2, so 2 is the shallowest knee a block can show.)
		const deptB = Array.from({ length: 6 }, (_, i) => ({
			paths: ['dept-b', `${i}`],
			stylesheetHrefs: [],
			html: `<body><main><article><section><span class="unique-b-${i}">c</span></section></article></main></body>`,
		}));

		const keys = await keysOf([...deptA, ...deptB]);
		const deptAKeys = keys.slice(0, deptA.length);
		const deptBKeys = keys.slice(deptA.length);

		expect(new Set(deptAKeys).size).toBe(1);
		expect(new Set(deptBKeys).size).toBe(1);
	});

	test('the always-on <main> depth cap skips the knee-detection sweep for a singleton block, but still returns that page as its own cluster', async () => {
		const pages = [
			{
				paths: ['solo'],
				stylesheetHrefs: [],
				html: '<body><main><div>only page</div></main></body>',
			},
		];

		expect(await keysOf(pages)).toHaveLength(1);
	});
});

describe('resolvePageClusterKeys (section-local landmarks)', () => {
	test('pages that share a section-local landmark cluster separately from block siblings that lack it', async () => {
		// Regression scenario mirroring the real-crawl section-local nav
		// case behind collecting every landmark instance: a subset of pages
		// in one block carries an in-<main> section-local <nav> that the
		// other pages in the same block don't. Landmarks are excised from the
		// compared content, so on their own the pages would look identical
		// and merge; the shared local-nav signature is what splits the
		// section pages off.
		const withLocalNav = Array.from({ length: 4 }, (_, i) => ({
			paths: ['articles', `with-${i}`],
			stylesheetHrefs: [],
			html:
				'<body>' +
				'<header><nav>global</nav></header>' +
				'<main>' +
				'<nav class="section-local-nav"><a>Section</a></nav>' +
				'<article><h1>title</h1><p>body</p></article>' +
				'</main>' +
				'</body>',
		}));
		const withoutLocalNav = Array.from({ length: 6 }, (_, i) => ({
			paths: ['articles', `without-${i}`],
			stylesheetHrefs: [],
			html:
				'<body>' +
				'<header><nav>global</nav></header>' +
				'<main><article><h1>title</h1><p>body</p></article></main>' +
				'</body>',
		}));
		const result = await keysOf([...withLocalNav, ...withoutLocalNav]);
		// All four with-nav pages share a cluster key; all six without-nav
		// pages share a different cluster key.
		const withKey = result[0]!;
		const withoutKey = result[4]!;
		expect(withKey).not.toBe(withoutKey);
		for (let i = 0; i < 4; i++) expect(result[i]).toBe(withKey);
		for (let i = 4; i < 10; i++) expect(result[i]).toBe(withoutKey);
	});

	test('a singleton local landmark on one page does not fragment the block', async () => {
		// A landmark signature carried by a single page is not treated as
		// section-local, so it cannot split the outlier off its siblings.
		// This is deliberate: real crawls include one-off editorial widgets
		// that shouldn't reshape clustering.
		const outlier = {
			paths: ['articles', 'outlier'],
			stylesheetHrefs: [],
			html:
				'<body>' +
				'<header><nav>global</nav></header>' +
				'<main><nav class="one-off-widget">unique</nav>' +
				'<article><h1>title</h1><p>body</p></article></main>' +
				'</body>',
		};
		const siblings = Array.from({ length: 9 }, (_, i) => ({
			paths: ['articles', `s-${i}`],
			stylesheetHrefs: [],
			html:
				'<body>' +
				'<header><nav>global</nav></header>' +
				'<main><article><h1>title</h1><p>body</p></article></main>' +
				'</body>',
		}));
		const result = await keysOf([outlier, ...siblings]);
		expect(result[0]).toBe(result[1]);
	});

	test('a global chrome signature (auto-cut cluster) does not discriminate pages', async () => {
		// Every page shares the same site-wide <header>. That signature's
		// corpus frequency is 1.0, so it is classified as global chrome and
		// contributes nothing to the comparison. Content-equivalent pages
		// therefore end up in one cluster.
		const pages = Array.from({ length: 6 }, (_, i) => ({
			paths: ['articles', `p-${i}`],
			stylesheetHrefs: [],
			html:
				'<body>' +
				'<header><nav>global</nav></header>' +
				'<main><article><p>body</p></article></main>' +
				'</body>',
		}));
		const result = await keysOf(pages);
		for (let i = 1; i < 6; i++) expect(result[i]).toBe(result[0]);
	});
});

describe('resolvePageClusterKeys (page-unique class stripping)', () => {
	/**
	 * A static-content page whose content root carries a per-page identity
	 * class (`<article class="<name>">`), the way a hand-authored site labels
	 * each page for CSS. The skeleton under the article is the same on every
	 * page; only the label differs.
	 * @param name
	 */
	function labeledStaticPage(name: string): string {
		return (
			'<body>' +
			'<header><nav>global</nav></header>' +
			'<div class="wrap">' +
			`<article class="${name}">` +
			'<h2>title</h2>' +
			'<section><h3>h</h3><p>text</p><img></section>' +
			'<section><h3>h</h3><p>text</p></section>' +
			'</article>' +
			'</div>' +
			'<footer>f</footer>' +
			'</body>'
		);
	}

	/**
	 * A structurally different page in the same block (a listing, not an
	 * article) — the control that must stay separate.
	 * @param i
	 */
	function listingPage(i: number): string {
		return (
			'<body>' +
			'<header><nav>global</nav></header>' +
			'<div class="wrap">' +
			`<ul class="listing listing-${i}"><li><a>a</a></li><li><a>b</a></li><li><a>c</a></li></ul>` +
			'<form><input><button>go</button></form>' +
			'</div>' +
			'<footer>f</footer>' +
			'</body>'
		);
	}

	test('pages that differ only by a per-page class on their content root share one cluster', async () => {
		// Regression scenario from a real crawl: five hand-authored static
		// pages under one URL section, each with `<article class="<page>">`.
		// Without stripping, the label prefixes every root-to-leaf path under
		// the article, so once the shared shell is removed by the frequency
		// split the pages compare as disjoint (Jaccard ≈ 0.08 on the real
		// data) and each ends up alone. The block also holds a listing family
		// so it is large enough for frequency-based stripping and so there is a
		// genuinely different template the static pages must not absorb.
		const labels = ['outline', 'weather', 'local', 'history', 'charm'];
		const statics = labels.map((name) => ({
			paths: ['about', `${name}.html`],
			stylesheetHrefs: [],
			html: labeledStaticPage(name),
		}));
		const listings = Array.from({ length: 6 }, (_, i) => ({
			paths: ['about', `list-${i}`],
			stylesheetHrefs: [],
			html: listingPage(i),
		}));
		const result = await keysOf([...statics, ...listings]);

		const staticKey = result[0]!;
		for (let i = 0; i < statics.length; i++) expect(result[i]).toBe(staticKey);
		const listingKey = result[statics.length]!;
		for (let i = statics.length; i < result.length; i++)
			expect(result[i]).toBe(listingKey);
		expect(staticKey).not.toBe(listingKey);
		expect(new Set(result).size).toBe(2);
	});

	test('stripping is skipped for a tiny block, so a tiny block keeps per-page classes', async () => {
		// Two pages alone cannot tell "page identifier" from "the one class
		// that distinguishes two templates" — the gate leaves them as they
		// are, and they stay apart exactly as they would without stripping.
		const result = await keysOf([
			{ paths: ['about', 'a.html'], stylesheetHrefs: [], html: labeledStaticPage('a') },
			{ paths: ['about', 'b.html'], stylesheetHrefs: [], html: labeledStaticPage('b') },
		]);
		expect(result[0]).not.toBe(result[1]);
	});

	test('a class shared by two pages of a large block is kept, so a genuine two-page variant still separates', async () => {
		// `.with-aside` recurs on exactly two pages, which is the floor for
		// "recurring": those two keep the class (and the aside subtree) and
		// split from the eight plain pages, while each page's own identity
		// class is still stripped.
		const plain = Array.from({ length: 8 }, (_, i) => ({
			paths: ['about', `p-${i}.html`],
			stylesheetHrefs: [],
			html: labeledStaticPage(`page-${i}`),
		}));
		const withAside = Array.from({ length: 2 }, (_, i) => ({
			paths: ['about', `aside-${i}.html`],
			stylesheetHrefs: [],
			html: labeledStaticPage(`aside-page-${i}`).replace(
				'</article>',
				'</article><aside class="with-aside"><ul><li><a>x</a></li><li><a>y</a></li></ul><p>note</p></aside>',
			),
		}));
		const result = await keysOf([...plain, ...withAside]);
		for (let i = 1; i < plain.length; i++) expect(result[i]).toBe(result[0]);
		expect(result[8]).toBe(result[9]);
		expect(result[8]).not.toBe(result[0]);
		expect(new Set(result).size).toBe(2);
	});

	test('stripped tokens stay comparable across blocks: the same labeled template in two URL sections merges in Stage B', async () => {
		// Stripping is decided per block, so two blocks of the same template
		// each strip their own identity labels independently. What remains is
		// the same skeleton in both, and Stage B's cross-block comparison of
		// quorum cores must recognize it as one template — otherwise the
		// per-block stripping would trade one fragmentation (per page) for
		// another (per section).
		const sectionA = Array.from({ length: 10 }, (_, i) => ({
			paths: ['section-a', `page-${i}.html`],
			stylesheetHrefs: [],
			html: labeledStaticPage(`a-${i}`),
		}));
		const sectionB = Array.from({ length: 10 }, (_, i) => ({
			paths: ['section-b', `page-${i}.html`],
			stylesheetHrefs: [],
			html: labeledStaticPage(`b-${i}`),
		}));
		const result = await keysOf([...sectionA, ...sectionB]);
		expect(new Set(result).size).toBe(1);
	});
});

describe('resolvePageClusterKeys (reasons)', () => {
	test('two clusters split within the same block are reported as siblings of each other', async () => {
		// Same fixture as "pages within the same block but with dissimilar
		// structure get different final keys" above: header/footer are
		// identical (and excluded from comparison), but the
		// <div> vs <form> distinguishing element still splits Stage A into
		// two clusters within the single `path:dept-a` block.
		const cardHtml =
			'<body><header>H</header><main><div class="card">C</div></main><footer>F</footer></body>';
		const formHtml =
			'<body><header>H</header><main><form>F</form></main><footer>F</footer></body>';
		const { keys: result, reasons } = await clusterOf([
			{ paths: ['dept-a', 'page1'], stylesheetHrefs: [], html: cardHtml },
			{ paths: ['dept-a', 'page2'], stylesheetHrefs: [], html: cardHtml },
			{ paths: ['dept-a', 'page3'], stylesheetHrefs: [], html: formHtml },
		]);

		// Precondition: the two clusters really did split within one block.
		expect(result[2]).not.toBe(result[0]);
		expect(reasons.size).toBe(2);

		const cardReason = reasons.get(result[0]!)!;
		const formReason = reasons.get(result[2]!)!;
		expect(cardReason.siblingClusterKeys).toEqual([result[2]]);
		expect(formReason.siblingClusterKeys).toEqual([result[0]]);
		expect(cardReason.blocking).toEqual(formReason.blocking);
	});

	test('a single page returns its key as a plain string[]', async () => {
		const html = '<body><header>H</header><main>content</main></body>';
		const result = await keysOf([{ paths: ['a'], stylesheetHrefs: [], html }]);
		expect(result).toStrictEqual(['["path:a","cluster:0"]']);
	});

	test("a header shared across the whole cluster reads as chrome (chromeRate 1); each page's own unique nav does not", async () => {
		const sharedHeader = '<header><nav>global</nav></header>';
		const html1 = `<body>${sharedHeader}<main><nav class="unique-1">x</nav><article>one</article></main></body>`;
		const html2 = `<body>${sharedHeader}<main><nav class="unique-2">y</nav><article>two</article></main></body>`;
		const { keys: result, reasons } = await clusterOf([
			{ paths: ['p', '1'], stylesheetHrefs: [], html: html1 },
			{ paths: ['p', '2'], stylesheetHrefs: [], html: html2 },
		]);
		// Both pages land in the same final cluster (identical header + same
		// article structure), so one reason covers both.
		expect(result[0]).toBe(result[1]);
		expect(reasons.size).toBe(1);
		const reason = reasons.get(result[0]!)!;
		expect(reason.memberCount).toBe(2);
		expect(reason.landmarks.header?.chromeRate).toBe(1);
		// Each page's nav carries a page-unique class not shared by the other
		// — content, not shell.
		expect(reason.landmarks.nav?.chromeRate).toBe(0);
	});

	test('main never appears in the landmarks of a reason — chrome discovery does not classify content', async () => {
		const html = '<body><header>H</header><main>content</main></body>';
		const { reasons } = await clusterOf([{ paths: ['a'], stylesheetHrefs: [], html }]);
		expect(Object.keys([...reasons.values()][0]!.landmarks)).not.toContain('main');
	});

	test('two distinct clusters each get a reason from their own shell discovery, not a corpus-wide one', async () => {
		// Cluster A's header/nav tokens never appear anywhere in cluster B's
		// pages, and vice versa. If the classifier's shell discovery ran once
		// over all 6 pages instead of once per final cluster, each header's
		// corpus-wide frequency would be 3/6 = 0.5 — below the single-distinct-
		// signature fallback clamp (0.8) — and neither would read as chrome.
		// Per-cluster computation gives each header a 3/3 = 1.0 frequency
		// within its own cluster, so both correctly read as chrome.
		const headerA = '<header><nav>team-a-nav</nav></header>';
		const headerB = '<header><nav>team-b-nav</nav></header>';
		const clusterAPages = Array.from({ length: 3 }, (_, i) => ({
			paths: ['team-a', `p${i}`],
			stylesheetHrefs: [],
			html: `<body>${headerA}<main><article>content ${i}</article></main></body>`,
		}));
		const clusterBPages = Array.from({ length: 3 }, (_, i) => ({
			paths: ['team-b', `p${i}`],
			stylesheetHrefs: [],
			html: `<body>${headerB}<main><section>content ${i}</section></main></body>`,
		}));
		const { keys: result, reasons } = await clusterOf([
			...clusterAPages,
			...clusterBPages,
		]);

		// Precondition: the two groups really are in different final clusters
		// (different blocking path AND different tag skeleton: article vs
		// section) — otherwise this test wouldn't be exercising the
		// per-cluster grouping at all.
		expect(reasons.size).toBe(2);
		expect(result[0]).toBe(result[1]);
		expect(result[0]).toBe(result[2]);
		expect(result[3]).toBe(result[4]);
		expect(result[3]).toBe(result[5]);

		for (const reason of reasons.values()) {
			expect(reason.landmarks.header?.chromeRate).toBe(1);
			expect(reason.memberCount).toBe(3);
		}
	});
});

describe('resolvePageClusterKeys (content root)', () => {
	const tags = [
		'em',
		'strong',
		'b',
		'i',
		'u',
		'code',
		'kbd',
		'samp',
		'var',
		'mark',
		'q',
		's',
	];

	/**
	 * Pages identical down to depth 3 under a wrapper with the given id and
	 * differing only in the tag at depth 4.
	 * @param wrapperId
	 */
	function pagesUnder(wrapperId: string) {
		return tags.map((tag, i) => ({
			paths: ['dept-a', `${i}`],
			stylesheetHrefs: [],
			html: `<body><div id="${wrapperId}"><section><article><div><${tag}>x</${tag}></div></article></section></div></body>`,
		}));
	}

	test('a contentRoot hint anchors the depth cap on pages without <main>', async () => {
		const withHint = pagesUnder('page').map((page) => ({
			...page,
			contentRoot: { tagName: 'div', id: 'page' },
		}));
		expect(new Set(await keysOf(withHint)).size).toBe(1);
		// Same pages, no hint, and `page` is not a built-in anchor: uncapped.
		expect(new Set(await keysOf(pagesUnder('page'))).size).toBe(12);
	});

	test('each page is capped with its own hint when several blocks are interleaved in the input', async () => {
		// Two blocks with different wrapper ids (neither a built-in anchor),
		// interleaved so that a hint list built in input order rather than per
		// block would hand a block the other block's hints.
		const blockA = pagesUnder('pageA').map((page) => ({
			...page,
			contentRoot: { id: 'pageA' },
		}));
		const blockB = pagesUnder('pageB').map((page) => ({
			...page,
			paths: ['dept-b', ...page.paths.slice(1)],
			contentRoot: { id: 'pageB' },
		}));
		const interleaved = blockA.flatMap((page, i) => [page, blockB[i]!]);
		const keys = await keysOf(interleaved);
		expect(new Set(keys.filter((_, i) => i % 2 === 0)).size).toBe(1);
		expect(new Set(keys.filter((_, i) => i % 2 === 1)).size).toBe(1);
	});

	test('without a hint the built-in fallback list anchors the cap (#main)', async () => {
		expect(new Set(await keysOf(pagesUnder('main'))).size).toBe(1);
	});
});
