import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { deriveDomPath } from '../archive/populate-entity-tables/derive-dom-path.js';

import { collectImageDomPaths } from './collect-image-dom-paths.js';

const FIXTURE_HTML = `<!doctype html>
<html>
	<body>
		<header><img src="logo.png" alt="logo"></header>
		<main>
			<section><p>intro</p></section>
			<section>
				<picture><img src="hero.png" alt="hero"></picture>
				<img src="inline-a.png" alt="a">
				<img src="inline-b.png" alt="b">
			</section>
		</main>
	</body>
</html>`;

describe('collectImageDomPaths', () => {
	it('collects every <img> in document order with slash-joined dom paths', () => {
		const dom = new JSDOM(FIXTURE_HTML);
		const candidates = collectImageDomPaths(dom.window.document);
		expect(candidates.map((c) => c.path)).toEqual([
			'html/body[1]/header[1]/img[1]',
			'html/body[1]/main[1]/section[2]/picture[1]/img[1]',
			'html/body[1]/main[1]/section[2]/img[1]',
			'html/body[1]/main[1]/section[2]/img[2]',
		]);
		expect(candidates[0]?.outerHTML).toContain('logo.png');
	});

	it('produces the exact same path as the Node-side deriveDomPath for every element', () => {
		// Cross-runtime consistency pin: live-crawled archives (this
		// function, serialised into the browser) and migrated archives
		// (deriveDomPath over HTML snapshots) must derive identical strings
		// for identical DOM shapes.
		const dom = new JSDOM(FIXTURE_HTML);
		const doc = dom.window.document;
		const candidates = collectImageDomPaths(doc);
		const images = [...doc.querySelectorAll('img')];
		expect(candidates).toHaveLength(images.length);
		for (const [index, img] of images.entries()) {
			expect(candidates[index]?.path).toBe(deriveDomPath(img));
		}
	});

	it('returns an empty array for a document with no images', () => {
		const dom = new JSDOM('<!doctype html><html><body><p>text</p></body></html>');
		expect(collectImageDomPaths(dom.window.document)).toEqual([]);
	});
});
