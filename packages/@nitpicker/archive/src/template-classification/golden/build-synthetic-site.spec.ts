import { describe, expect, it } from 'vitest';

import { buildSyntheticSite } from './build-synthetic-site.js';

describe('buildSyntheticSite', () => {
	it('同じ seed と scale からは同じコーパスを作る', () => {
		expect(buildSyntheticSite({ seed: 7, scale: 1 })).toEqual(
			buildSyntheticSite({ seed: 7, scale: 1 }),
		);
	});

	it('seed が違うと HTML が変わる', () => {
		const a = buildSyntheticSite({ seed: 7, scale: 1 });
		const b = buildSyntheticSite({ seed: 8, scale: 1 });

		expect(a.map((page) => page.html)).not.toEqual(b.map((page) => page.html));
	});

	it('scale 1 は 267 ページで、one-off の 4 ページ以外が scale 倍になる', () => {
		expect(buildSyntheticSite({ seed: 7, scale: 1 })).toHaveLength(267);
		expect(buildSyntheticSite({ seed: 7, scale: 2 })).toHaveLength(530);
	});

	it('ホストと stylesheet はすべて予約済みドメイン（.example / example.net）にある', () => {
		const pages = buildSyntheticSite({ seed: 7, scale: 1 });
		const hosts = new Set([
			...pages.map((page) => page.host),
			...pages.flatMap((page) => page.stylesheetHrefs.map((href) => new URL(href).host)),
		]);

		expect([...hosts].toSorted()).toEqual(['cdn.example.net', 'golden.example']);
	});

	it('contentRoot のヒントは blog の 4 ページに 3 ページだけ付く', () => {
		const blog = buildSyntheticSite({ seed: 7, scale: 1 }).filter(
			(page) => page.paths[0] === 'blog',
		);

		expect(blog).toHaveLength(30);
		expect(blog.filter((page) => page.contentRoot !== undefined)).toHaveLength(23);
	});
});
