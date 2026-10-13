import type {
	GoldenPage,
	ModuleRenderer,
	SyntheticSection as Section,
	SyntheticSiteContext as Context,
	SyntheticSiteOptions,
} from './types.js';

import { createSeededRandom } from './create-seeded-random.js';

/** Host of every page; `.example` is reserved (RFC 2606). */
const HOST = 'golden.example';

/** Stylesheet every first-party section shares. */
const MAIN_CSS = `https://${HOST}/assets/main.css`;

/**
 * Builds a deterministic multi-template site for the golden test of the
 * template classifier. Real crawls cannot be committed, and the bundled
 * HTML fixtures are unrelated single pages that never form clusters, so
 * this generator is what makes the golden exercise the classifier's
 * cross-page logic. The sections are chosen to reach every stage:
 *
 * - several stylesheet blocks, a path block (no stylesheets) and one-off
 *   pages with their own stylesheet (Pass 0's orphan reassignment)
 * - two templates sharing a block (Stage A splits it), and one template in
 *   two blocks (Stage B merges it)
 * - blocks of 9 and of 10 or more pages, either side of the size where the
 *   document-frequency split and the recurring-class allow-list kick in
 * - a sidebar on part of a block (local landmark chrome), deep and varying
 *   nesting (the content-depth sweep), pages without `<main>` whose content
 *   root comes from the crawler's hint, and `role="main"`
 * - byte-identical pages (similarity ties), malformed markup that relies
 *   on the HTML parser's implied closes, entity-encoded and non-ASCII class
 *   names, comments, `<script>` / `<style>` / `<svg>` / `<noscript>`
 *
 * `scale` multiplies every section except the one-off pages, so a large
 * scale reproduces the same site shape above the streaming threshold.
 * @param options - See {@link SyntheticSiteOptions}.
 * @returns The corpus in a fixed order.
 * @example
 * ```ts
 * const pages = buildSyntheticSite({ seed: 1, scale: 1 });
 * ```
 */
export function buildSyntheticSite(options: SyntheticSiteOptions): GoldenPage[] {
	const random = createSeededRandom(options.seed);
	let counter = 0;
	const context: Context = { random, next: () => counter++ };

	const pages: GoldenPage[] = [];
	for (const section of SECTIONS) {
		const count = section.scales ? section.baseCount * options.scale : section.baseCount;
		for (let index = 0; index < count; index++) {
			pages.push(section.render(context, index));
		}
	}
	return pages;
}

/**
 * @param random - The PRNG.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @returns A uniform integer in `[min, max]`.
 */
function between(random: () => number, min: number, max: number): number {
	return min + Math.floor(random() * (max - min + 1));
}

/**
 * @param count - How many copies.
 * @param render - Renders copy `index`.
 * @returns The copies concatenated.
 */
function repeat(count: number, render: (index: number) => string): string {
	let out = '';
	for (let index = 0; index < count; index++) {
		out += render(index);
	}
	return out;
}

/**
 * @param title - The `<title>`.
 * @param body - Everything inside `<body>`.
 * @param bodyClass - The `<body>` class attribute.
 * @returns A full document.
 */
function documentOf(title: string, body: string, bodyClass = 'page'): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>.page{margin:0}</style></head><body class="${bodyClass}">${body}</body></html>`;
}

/**
 * @returns The header every first-party section shares.
 */
function siteHeader(): string {
	return `<header class="site-header"><div class="site-header__inner"><a class="site-logo" href="/"><svg class="icon" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>Logo</a><nav class="global-nav"><ul class="global-nav__list">${repeat(
		5,
		(index) =>
			`<li class="global-nav__item"><a class="global-nav__link" href="/s${index}/">Section ${index}</a></li>`,
	)}</ul></nav><form class="site-search" role="search"><input class="site-search__input" type="search"><button class="site-search__button">Go</button></form></div></header>`;
}

/**
 * @returns The footer every first-party section shares.
 */
function siteFooter(): string {
	return `<footer class="site-footer"><ul class="site-footer__links">${repeat(
		4,
		(index) =>
			`<li class="site-footer__item"><a class="site-footer__link" href="/f${index}/">Link ${index}</a></li>`,
	)}</ul><p class="site-footer__copy">&copy; Example</p></footer><script>window.dataLayer = window.dataLayer || [];</script>`;
}

/**
 * @param id - Page number, so the JSON differs on every page.
 * @returns A per-page structured-data script (an opaque, hashed token).
 */
function structuredData(id: number): string {
	return `<script type="application/ld+json">{"@type":"WebPage","identifier":"page-${id}"}</script>`;
}

/**
 * @param trail - Breadcrumb labels.
 * @returns A breadcrumb navigation.
 */
function breadcrumb(trail: readonly string[]): string {
	return `<nav class="breadcrumb" aria-label="Breadcrumb"><ol class="breadcrumb__list">${trail
		.map(
			(label) =>
				`<li class="breadcrumb__item"><a class="breadcrumb__link" href="#">${label}</a></li>`,
		)
		.join('')}</ol></nav>`;
}

/**
 * @param random - The PRNG.
 * @returns A sidebar shown on only part of a section (local chrome).
 */
function sidebar(random: () => number): string {
	return `<aside class="sidebar"><h2 class="sidebar__title">Popular</h2><ul class="sidebar__list">${repeat(
		between(random, 3, 5),
		(index) =>
			`<li class="sidebar__item"><a class="sidebar__link" href="#p${index}">Post ${index}</a></li>`,
	)}</ul></aside>`;
}

/**
 * The article template, shared by the news and events sections.
 * @param context - Generation context.
 * @param section - Section name, used in labels.
 * @param withSidebar - Whether this page carries the local sidebar.
 * @returns The page body.
 */
function articleBody(context: Context, section: string, withSidebar: boolean): string {
	const { random } = context;
	const id = context.next();
	const paragraphs = repeat(
		between(random, 2, 7),
		(index) => `<p class="article__text">Paragraph ${index} of story ${id}.</p>`,
	);
	const figure =
		random() < 0.5
			? `<figure class="article__figure"><img class="article__image" src="/i/${id}.jpg" alt=""><figcaption class="article__caption">Caption</figcaption></figure>`
			: '';
	const quote =
		random() < 0.3
			? `<blockquote class="article__quote"><p>Quoted words.</p></blockquote>`
			: '';
	return `${siteHeader()}${breadcrumb(['Home', section])}<main id="main" class="main"><article class="article"><h1 class="article__title">Story ${id}</h1><div class="article__meta"><time class="article__date" datetime="2026-01-01">Jan 1</time><span class="tag tag--${section}">${section}</span></div><div class="article__body">${paragraphs}${figure}${quote}</div><div class="share"><a class="share__link share__link--x" href="#">Share</a><a class="share__link share__link--mail" href="#">Mail</a></div></article></main>${withSidebar ? sidebar(random) : ''}${siteFooter()}${structuredData(id)}`;
}

/**
 * The listing template, shared by the news and events sections.
 * @param context - Generation context.
 * @param section - Section name, used in labels.
 * @returns The page body.
 */
function listBody(context: Context, section: string): string {
	const { random } = context;
	const id = context.next();
	const cards = repeat(
		between(random, 6, 12),
		(index) =>
			`<li class="card"><a class="card__link" href="#c${index}"><span class="card__thumb"><img class="card__image" src="/t/${index}.jpg" alt=""></span><span class="card__title">Item ${index}</span><span class="card__date">Jan ${index + 1}</span></a></li>`,
	);
	const pager = repeat(
		between(random, 3, 6),
		(index) => `<a class="pager__number" href="?page=${index + 1}">${index + 1}</a>`,
	);
	return `${siteHeader()}${breadcrumb(['Home', section])}<main id="main" class="main"><h1 class="page-title">${section} list ${id}</h1><ul class="card-list">${cards}</ul><nav class="pager" aria-label="Pagination"><a class="pager__prev" href="#">Prev</a>${pager}<a class="pager__next" href="#">Next</a></nav></main>${siteFooter()}${structuredData(id)}`;
}

/**
 * @param context - Generation context.
 * @returns A product detail body (table rows and gallery vary).
 */
function productBody(context: Context): string {
	const { random } = context;
	const id = context.next();
	const specs = repeat(
		between(random, 3, 9),
		(index) =>
			`<tr class="spec__row"><th class="spec__name">Spec ${index}</th><td class="spec__value">${index * 3}</td></tr>`,
	);
	const gallery = repeat(
		between(random, 1, 4),
		(index) =>
			`<li class="gallery__item"><img class="gallery__image" src="/p/${id}-${index}.jpg" alt=""></li>`,
	);
	return `${siteHeader()}${breadcrumb(['Home', 'Shop', 'Item'])}<main id="main" class="main"><div class="product"><div class="product__visual"><ul class="gallery">${gallery}</ul></div><div class="product__summary"><h1 class="product__name">Product ${id}</h1><p class="product__price">$${between(random, 10, 99)}</p><button class="product__buy button button--primary">Buy</button></div></div><table class="spec"><tbody>${specs}</tbody></table></main>${siteFooter()}${structuredData(id)}`;
}

/**
 * @param context - Generation context.
 * @returns A product category grid body.
 */
function categoryBody(context: Context): string {
	const { random } = context;
	const id = context.next();
	const tiles = repeat(
		between(random, 8, 16),
		(index) =>
			`<li class="grid__cell"><a class="tile" href="#t${index}"><img class="tile__image" src="/g/${index}.jpg" alt=""><span class="tile__name">Product ${index}</span><span class="tile__price">$${index + 10}</span></a></li>`,
	);
	return `${siteHeader()}${breadcrumb(['Home', 'Shop'])}<main id="main" class="main"><h1 class="page-title">Category ${id}</h1><div class="filters"><select class="filters__sort"><option>New</option><option>Price</option></select></div><ul class="grid">${tiles}</ul></main>${siteFooter()}${structuredData(id)}`;
}

/**
 * A blog without `<main>`: the content root is `div#content`, which the
 * crawler's hint names on most pages (as `Element.nodeName` reports it,
 * upper-case) and the built-in fallback list finds on the rest.
 * @param context - Generation context.
 * @param index - Position in the section.
 * @returns The page's signals.
 */
function blogPage(context: Context, index: number): GoldenPage {
	const { random } = context;
	const id = context.next();
	const entries = repeat(
		between(random, 2, 6),
		(paragraph) => `<p>Blog paragraph ${paragraph}.</p>`,
	);
	const comments = repeat(
		between(random, 0, 4),
		(comment) =>
			`<li class="comment"><span class="comment__author">Reader ${comment}</span><p class="comment__text">Nice.</p></li>`,
	);
	const html = documentOf(
		`Blog ${id}`,
		`<div id="wrap"><div id="head"><h1 class="blog-name">Blog</h1></div><div id="content" class="content"><div class="entry"><h2 class="entry-title">Entry ${id}</h2><div class="entry-content">${entries}</div><ul class="comments">${comments}</ul></div></div><div id="side"><div class="widget"><h3 class="widget-title">Archive</h3><ul class="widget-list"><li>2026</li><li>2025</li></ul></div></div><div id="foot">Blog footer</div></div><noscript><img src="/pixel.gif" alt=""></noscript>`,
		'blog',
	);
	return {
		paths: ['blog', `entry-${index}`],
		stylesheetHrefs: [],
		html,
		host: HOST,
		...(index % 4 === 3 ? {} : { contentRoot: { tagName: 'DIV', id: 'content' } }),
	};
}

/**
 * @param depth - Nesting depth below the section.
 * @param leaf - Markup at the bottom.
 * @returns `depth` nested wrappers, alternating named and anonymous ones.
 */
function nest(depth: number, leaf: string): string {
	if (depth === 0) {
		return leaf;
	}
	const open = depth % 2 === 0 ? '<div class="level">' : '<div>';
	return `${open}${nest(depth - 1, leaf)}</div>`;
}

/**
 * Documentation pages whose content nests to a varying depth, so the
 * content-depth sweep sees the cluster count change across depths.
 * @param context - Generation context.
 * @returns The page body.
 */
function docsBody(context: Context): string {
	const { random } = context;
	const id = context.next();
	const sections = repeat(
		between(random, 2, 5),
		(index) =>
			`<section class="doc-section"><h2 class="doc-section__title">Part ${index}</h2>${nest(
				between(random, 2, 11),
				`<p class="doc-section__text">Detail ${index}.</p><ul class="doc-list"><li class="doc-list__item"><code>call()</code></li></ul>`,
			)}</section>`,
	);
	return `${siteHeader()}<div class="docs-layout"><nav class="docs-nav"><ul class="docs-nav__list"><li><a href="#">Intro</a></li><li><a href="#">Guide</a></li></ul></nav><main id="main" class="main docs"><h1 class="doc-title">Doc ${id}</h1>${sections}</main></div>${siteFooter()}`;
}

/**
 * Legacy markup that only parses as intended through implied closes and
 * other HTML-mode quirks: upper-case tags, unquoted attributes, `<p>`
 * closed by a block element, unclosed `<li>` / `<td>`, a stray end tag,
 * a self-closing `<br/>`, a second `<body>` and an HTML comment.
 * @param context - Generation context.
 * @returns The full document (not wrapped by {@link documentOf}).
 */
function legacyDocument(context: Context): string {
	const { random } = context;
	const id = context.next();
	const rows = repeat(
		between(random, 2, 5),
		(index) => `<TR><TD class=cell>${index}<TD class=cell>${index * 2}`,
	);
	const items = repeat(between(random, 2, 4), (index) => `<li class=item>Item ${index}`);
	return `<HTML><HEAD><TITLE>Legacy ${id}</TITLE></HEAD><BODY BGCOLOR=white><!-- legacy layout --><CENTER><TABLE class=layout WIDTH=600>${rows}</TABLE></CENTER><P class=lead>Intro<DIV class=box>Box ${id}<br/>line</DIV></div><ul class=menu>${items}</ul><body class=nested><FONT SIZE=2>Footer</FONT></BODY></HTML>`;
}

// cspell:ignore liste élément Élément
/**
 * Class names that only match once entities are decoded, plus non-ASCII
 * and mixed-case ones.
 * @param context - Generation context.
 * @returns The page body.
 */
function intlBody(context: Context): string {
	const { random } = context;
	const id = context.next();
	const items = repeat(
		between(random, 2, 6),
		(index) =>
			`<li class="liste__élément Item--A">Élément ${index} <span class="見出し">見出し</span></li>`,
	);
	return `${siteHeader()}<main id="main" class="main"><h1 class="titre&#45;principal">Titre ${id}</h1><div class="a&amp;b c&nbsp;d"><ul class="liste">${items}</ul></div><p class="note&#x2D;bas">Note</p></main>${siteFooter()}`;
}

// Content blocks of a CMS page builder. `composedBody` picks a random subset
// per page, so pages of the section share some blocks and not others — the
// similarities spread across the clustering threshold instead of sitting at
// 0 or 1, which is what makes the cut height, the merge order and the
// tie-breaks matter. (A line comment: as JSDoc on an array of functions, the
// linter's autofix keeps inserting an empty `@param`.)
const MODULES: readonly ModuleRenderer[] = [
	() =>
		`<div class="mod-lead"><p class="mod-lead__text">Lead</p><p class="mod-lead__note">Note</p></div>`,
	() =>
		`<div class="mod-heading"><h2 class="mod-heading__title">Heading</h2><p class="mod-heading__sub">Sub</p></div>`,
	() =>
		`<figure class="mod-photo"><img class="mod-photo__image" src="/m.jpg" alt=""><figcaption class="mod-photo__caption">Caption</figcaption></figure>`,
	(random) =>
		`<div class="mod-table"><table class="mod-table__table"><tbody>${repeat(
			between(random, 1, 4),
			(index) =>
				`<tr class="mod-table__row"><td class="mod-table__cell">${index}</td></tr>`,
		)}</tbody></table></div>`,
	(random) =>
		`<div class="mod-accordion">${repeat(
			between(random, 1, 3),
			(index) =>
				`<details class="mod-accordion__item"><summary class="mod-accordion__question">Q${index}</summary><p class="mod-accordion__answer">A${index}</p></details>`,
		)}</div>`,
	(random) =>
		`<ol class="mod-steps">${repeat(
			between(random, 2, 4),
			(index) =>
				`<li class="mod-steps__item"><span class="mod-steps__number">${index}</span><p class="mod-steps__text">Step</p></li>`,
		)}</ol>`,
	() =>
		`<div class="mod-map"><iframe class="mod-map__frame" src="/map" title="Map"></iframe></div>`,
	() =>
		`<div class="mod-notice"><p class="mod-notice__text">Notice</p><a class="mod-notice__link" href="#">More</a></div>`,
	(random) =>
		`<dl class="mod-definitions">${repeat(
			between(random, 1, 3),
			(index) =>
				`<dt class="mod-definitions__term">T${index}</dt><dd class="mod-definitions__detail">D${index}</dd>`,
		)}</dl>`,
	() =>
		`<div class="mod-video"><video class="mod-video__player" src="/v.mp4" controls></video></div>`,
];

/**
 * @param context - Generation context.
 * @returns A page-builder body of 3–6 random modules, in random order.
 */
function composedBody(context: Context): string {
	const { random } = context;
	const id = context.next();
	const count = between(random, 3, 6);
	let modules = '';
	for (let index = 0; index < count; index++) {
		const module = MODULES[Math.floor(random() * MODULES.length)];
		modules += module ? module(random) : '';
	}
	return `${siteHeader()}<main id="main" class="main"><h1 class="page-title">Page ${id}</h1>${modules}</main>${siteFooter()}`;
}

/** Byte-identical campaign page: every pair of these ties at similarity 1. */
const CAMPAIGN_HTML = documentOf(
	'Campaign',
	`${siteHeader()}<main id="main" class="main"><section class="hero"><h1 class="hero__title">Sale</h1><p class="hero__lead">Now on.</p><a class="hero__cta button" href="#">Shop</a></section><ul class="benefits"><li class="benefits__item">Fast</li><li class="benefits__item">Free</li></ul></main>${siteFooter()}`,
);

/**
 * A landing page whose content root is `role="main"` and which loads a
 * third-party stylesheet (dropped by the first-party filter).
 * @param context - Generation context.
 * @returns The page body.
 */
function landingBody(context: Context): string {
	const { random } = context;
	const id = context.next();
	const features = repeat(
		between(random, 2, 5),
		(index) =>
			`<div class="feature"><h2 class="feature__title">Feature ${index}</h2><p class="feature__text">Text.</p></div>`,
	);
	return `${siteHeader()}<div role="main" class="lp"><section class="lp-hero"><h1 class="lp-hero__title">Launch ${id}</h1></section><div class="features">${features}</div><form class="lp-form"><input class="lp-form__email" type="email"><button class="lp-form__submit">Join</button></form></div>${siteFooter()}`;
}

/**
 * @param name - Path segment and stylesheet name.
 * @param body - Page body.
 * @returns A one-off page with a stylesheet no other page loads.
 */
function oneOffPage(name: string, body: string): GoldenPage {
	return {
		paths: name === '' ? [] : [name],
		stylesheetHrefs: name === '' ? [] : [MAIN_CSS, `https://${HOST}/assets/${name}.css`],
		html: documentOf(name || 'Home', `${siteHeader()}${body}${siteFooter()}`),
		host: HOST,
	};
}

/**
 * @param section - First path segment.
 * @param index - Position in the section.
 * @param stylesheet - Section stylesheet name.
 * @param html - The full document.
 * @returns First-party section page signals.
 */
function sectionPage(
	section: string,
	index: number,
	stylesheet: string,
	html: string,
): GoldenPage {
	return {
		paths: [section, `page-${index}`],
		stylesheetHrefs: [MAIN_CSS, `https://${HOST}/assets/${stylesheet}.css`],
		html,
		host: HOST,
	};
}

/** The site, in corpus order. */
const SECTIONS: readonly Section[] = [
	{
		baseCount: 48,
		scales: true,
		render: (context, index) =>
			sectionPage(
				'news',
				index,
				'news',
				documentOf('News', articleBody(context, 'news', context.random() < 0.4)),
			),
	},
	{
		baseCount: 14,
		scales: true,
		render: (context, index) =>
			sectionPage(
				'news',
				1000 + index,
				'news',
				documentOf('News', listBody(context, 'news')),
			),
	},
	{
		baseCount: 18,
		scales: true,
		render: (context, index) =>
			sectionPage(
				'events',
				index,
				'events',
				documentOf('Events', articleBody(context, 'events', false)),
			),
	},
	{
		baseCount: 4,
		scales: true,
		render: (context, index) =>
			sectionPage(
				'events',
				1000 + index,
				'events',
				documentOf('Events', listBody(context, 'events')),
			),
	},
	{
		baseCount: 36,
		scales: true,
		render: (context, index) => {
			const page = sectionPage(
				'shop',
				index,
				'shop',
				documentOf('Shop', productBody(context)),
			);
			// Every 12th product lost its stylesheet data (a crawl gap): an
			// orphan that Pass 0 folds back into the section's `css:` block.
			return index % 12 === 11 ? { ...page, stylesheetHrefs: [] } : page;
		},
	},
	{
		baseCount: 10,
		scales: true,
		render: (context, index) =>
			sectionPage(
				'shop',
				1000 + index,
				'shop',
				documentOf('Shop', categoryBody(context)),
			),
	},
	{ baseCount: 30, scales: true, render: blogPage },
	{
		baseCount: 25,
		scales: true,
		render: (context, index) =>
			sectionPage('docs', index, 'docs', documentOf('Docs', docsBody(context))),
	},
	{
		baseCount: 9,
		scales: true,
		render: (context, index) => ({
			paths: ['legacy', `page-${index}.html`],
			stylesheetHrefs: [`https://${HOST}/legacy/style.css`],
			html: legacyDocument(context),
			host: HOST,
		}),
	},
	{
		baseCount: 11,
		scales: true,
		render: (context, index) =>
			sectionPage('intl', index, 'intl', documentOf('Intl', intlBody(context))),
	},
	{
		baseCount: 12,
		scales: true,
		render: (_context, index) =>
			sectionPage('campaign', index, 'campaign', CAMPAIGN_HTML),
	},
	{
		baseCount: 40,
		scales: true,
		render: (context, index) =>
			sectionPage('pages', index, 'pages', documentOf('Pages', composedBody(context))),
	},
	{
		baseCount: 6,
		scales: true,
		render: (context, index) => ({
			...sectionPage('lp', index, 'lp', documentOf('Landing', landingBody(context))),
			stylesheetHrefs: [
				MAIN_CSS,
				`https://${HOST}/assets/lp.css`,
				'https://cdn.example.net/lib.css',
			],
		}),
	},
	{
		baseCount: 1,
		scales: false,
		render: () =>
			oneOffPage(
				'',
				`<main id="main" class="main home"><section class="hero"><h1 class="hero__title">Welcome</h1></section></main>`,
			),
	},
	{
		baseCount: 1,
		scales: false,
		render: () =>
			oneOffPage(
				'about',
				`<main id="main" class="main"><h1 class="page-title">About</h1><dl class="facts"><dt>Founded</dt><dd>2000</dd></dl></main>`,
			),
	},
	{
		baseCount: 1,
		scales: false,
		render: () =>
			oneOffPage(
				'contact',
				`<main id="main" class="main"><h1 class="page-title">Contact</h1><form class="contact-form"><label>Name<input></label><textarea></textarea><button>Send</button></form></main>`,
			),
	},
	{
		baseCount: 1,
		scales: false,
		render: () =>
			oneOffPage(
				'privacy',
				`<main id="main" class="main"><h1 class="page-title">Privacy</h1><ol class="terms"><li>One</li><li>Two</li></ol></main>`,
			),
	},
];
