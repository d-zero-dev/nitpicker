import type { PageData } from '../../../utils/types/types.js';

import { describe, expect, it } from 'vitest';

import { extractTechnologiesForArchive } from './extract-technologies-for-archive.js';

/**
 * @param overrides
 */
function makeMeta(overrides: Partial<PageData['meta']> = {}): PageData['meta'] {
	return { tags: { detected: {}, entries: [] }, ...overrides } as PageData['meta'];
}

describe('extractTechnologiesForArchive', () => {
	it('combines a structural HTML signal with a compounding wappalyzer signal', () => {
		const html = '<div id="__next"></div>';
		const meta = makeMeta({
			tags: {
				detected: {},
				entries: [
					{ provider: 'Next.js', categories: ['JavaScript frameworks'], sources: [] },
				],
			},
		});
		const { signals, technologies } = extractTechnologiesForArchive(html, meta);
		expect(signals).toHaveLength(2);
		expect(signals.map((s) => s.signalType)).toEqual(
			expect.arrayContaining(['html-marker', 'wappalyzer']),
		);
		const [nextjs] = technologies;
		expect(nextjs?.technology).toBe('Next.js');
		// 1 - (1-0.6)(1-0.6) = 0.84
		expect(nextjs?.confidence).toBe(84);
	});

	it('includes a meta-generator structural signal alongside wappalyzer', () => {
		const meta = makeMeta({ generator: 'Astro v4.2.0' });
		const { signals, technologies } = extractTechnologiesForArchive(
			'<html></html>',
			meta,
		);
		expect(signals).toEqual([
			expect.objectContaining({ technology: 'Astro', signalType: 'meta-generator' }),
		]);
		expect(technologies[0]?.technology).toBe('Astro');
		expect(technologies[0]?.version).toBe('v4.2.0');
	});

	it('returns no signals or technologies for a page with nothing detected', () => {
		const { signals, technologies } = extractTechnologiesForArchive(
			'<html><body>plain</body></html>',
			makeMeta(),
		);
		expect(signals).toEqual([]);
		expect(technologies).toEqual([]);
	});

	it('tolerates a meta object with no tags field (legacy minimal fixtures)', () => {
		const meta = { generator: undefined, tags: undefined } as unknown as PageData['meta'];
		expect(() => extractTechnologiesForArchive('<html></html>', meta)).not.toThrow();
	});
});
