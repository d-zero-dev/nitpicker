import type { DedupeCapObservationRow } from '../../archive/types.js';

import { describe, expect, it } from 'vitest';

import { buildDedupeCapObservation } from './build-dedupe-cap-observation.js';

/**
 *
 * @param overrides
 */
function buildRow(
	overrides: Partial<DedupeCapObservationRow> = {},
): DedupeCapObservationRow {
	return {
		url: 'https://example.com/news/date/2024/',
		title: 'お知らせ',
		description: null,
		ogTitle: null,
		ogUrl: null,
		bodyHash: Buffer.from('body-hash'),
		...overrides,
	};
}

describe('buildDedupeCapObservation', () => {
	it('shapeKey・metaSig・url を row から復元する', () => {
		const observation = buildDedupeCapObservation(buildRow());
		expect(observation).not.toBeNull();
		expect(observation?.shapeKey).toBe('example.com/news/date/{n}/');
		expect(observation?.url).toBe('https://example.com/news/date/2024/');
		expect(observation?.metaSig).not.toBeNull();
	});

	it('bodyHash は row の Buffer をそのまま使う', () => {
		const bodyHash = Buffer.from('specific-hash');
		const observation = buildDedupeCapObservation(buildRow({ bodyHash }));
		expect(observation?.bodyHash).toBe(bodyHash);
	});

	it('og:url が自 URL と異なれば ogUrlMismatch=true', () => {
		const observation = buildDedupeCapObservation(
			buildRow({ ogUrl: 'https://example.com/news/' }),
		);
		expect(observation?.ogUrlMismatch).toBe(true);
	});

	it('og:url が無ければ ogUrlMismatch=false', () => {
		const observation = buildDedupeCapObservation(buildRow({ ogUrl: null }));
		expect(observation?.ogUrlMismatch).toBe(false);
	});

	it('shapeKey が計算できない URL では null を返す', () => {
		const observation = buildDedupeCapObservation(buildRow({ url: 'not a url' }));
		expect(observation).toBeNull();
	});

	it('title・description・og:* が全て空なら null を返す（metaSig 無し）', () => {
		const observation = buildDedupeCapObservation(
			buildRow({ title: '', description: null, ogTitle: null, ogUrl: null }),
		);
		expect(observation).toBeNull();
	});

	it('title が null（DB上のNULL）でも description/og の代わりに空文字扱いになる', () => {
		const observation = buildDedupeCapObservation(
			buildRow({ title: null, ogTitle: 'OG Title' }),
		);
		expect(observation).not.toBeNull();
	});

	it('同一の title/description/og:* を持つ2行は同一 metaSig になる', () => {
		const rowA = buildRow({ description: '一覧です', ogTitle: 'お知らせ一覧' });
		const rowB = buildRow({ description: '一覧です', ogTitle: 'お知らせ一覧' });
		const a = buildDedupeCapObservation(rowA);
		const b = buildDedupeCapObservation(rowB);
		expect(a?.metaSig).toBe(b?.metaSig);
	});
});
