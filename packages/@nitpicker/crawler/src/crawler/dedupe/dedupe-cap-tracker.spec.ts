import { describe, expect, it } from 'vitest';

import DedupeCapTracker from './dedupe-cap-tracker.js';

/**
 *
 * @param overrides
 * @param overrides.shapeKey
 * @param overrides.metaSig
 * @param overrides.bodyHash
 * @param overrides.ogUrlMismatch
 * @param overrides.url
 */
function observation(overrides: {
	shapeKey?: string;
	metaSig?: string;
	bodyHash?: Buffer;
	ogUrlMismatch?: boolean;
	url?: string;
}) {
	return {
		shapeKey: 'shapeA',
		metaSig: 'sigA',
		bodyHash: Buffer.from('body-1'),
		ogUrlMismatch: false,
		url: 'https://example.com/news/date/2024/',
		...overrides,
	};
}

describe('DedupeCapTracker', () => {
	it('metaSig一致でcountが増え、閾値到達でcapイベントを返す', () => {
		const tracker = new DedupeCapTracker({ cap: 3, mapCap: 100 });

		expect(tracker.observe(observation({ bodyHash: Buffer.from('b1') }))).toBeNull();
		expect(tracker.observe(observation({ bodyHash: Buffer.from('b2') }))).toBeNull();
		const event = tracker.observe(
			observation({
				bodyHash: Buffer.from('b3'),
				url: 'https://example.com/news/date/2026/',
			}),
		);

		expect(event).toEqual({
			shapeKey: 'shapeA',
			sampleUrl: 'https://example.com/news/date/2026/',
			bodyHash: Buffer.from('b3'),
			effectiveThreshold: 3,
			observedCount: 3,
		});
	});

	it('cap到達でstickyへ移送しstateから削除される', () => {
		const tracker = new DedupeCapTracker({ cap: 2, mapCap: 100 });
		tracker.observe(observation({}));
		expect(tracker.isCapped('shapeA')).toBe(false);
		expect(tracker.size).toBe(1);

		tracker.observe(observation({}));
		expect(tracker.isCapped('shapeA')).toBe(true);
		expect(tracker.size).toBe(0);
		expect(tracker.stickyCount).toBe(1);
	});

	it('capped shapeへのobserveはno-op', () => {
		const tracker = new DedupeCapTracker({ cap: 1, mapCap: 100 });
		const firstEvent = tracker.observe(observation({}));
		expect(firstEvent).not.toBeNull();
		expect(tracker.stickyCount).toBe(1);

		const secondCall = tracker.observe(
			observation({ url: 'https://example.com/other/' }),
		);
		expect(secondCall).toBeNull();
		expect(tracker.stickyCount).toBe(1);
		expect(tracker.size).toBe(0);
	});

	it('metaSig不一致でcountが減り、0でスロットが新しいsigにリセットされる', () => {
		const tracker = new DedupeCapTracker({ cap: 3, mapCap: 100 });

		// A: count=1
		tracker.observe(observation({ metaSig: 'A', bodyHash: Buffer.from('a1') }));
		// B (mismatch): count-- => 0 -> reset to {metaSig: B, count: 1}
		const afterReset = tracker.observe(
			observation({ metaSig: 'B', bodyHash: Buffer.from('b1') }),
		);
		expect(afterReset).toBeNull();
		// B match: count=2
		expect(
			tracker.observe(observation({ metaSig: 'B', bodyHash: Buffer.from('b2') })),
		).toBeNull();
		// B match: count=3 -> cap (reset を経てからちょうど3回目でcapする = リセットが正しく効いている証拠)
		const capped = tracker.observe(
			observation({ metaSig: 'B', bodyHash: Buffer.from('b3') }),
		);
		expect(capped?.observedCount).toBe(3);
	});

	it('body_hashがスロットの記録値と一致すると実効閾値が半分(切り上げ)になる', () => {
		const tracker = new DedupeCapTracker({ cap: 5, mapCap: 100 });
		const bodyHash = Buffer.from('same-body');

		// スロット作成時のbodyHashを記録
		tracker.observe(observation({ bodyHash }));
		// 2回目: bodyHash一致 → 実効閾値 ceil(5/2)=3、count=2 (<3) → まだcapしない
		expect(tracker.observe(observation({ bodyHash }))).toBeNull();
		// 3回目: count=3 >= 3 → cap（bodyHash一致がなければcap=5でまだ足りないはず）
		const capped = tracker.observe(observation({ bodyHash }));
		expect(capped).toEqual({
			shapeKey: 'shapeA',
			sampleUrl: 'https://example.com/news/date/2024/',
			bodyHash,
			effectiveThreshold: 3,
			observedCount: 3,
		});
	});

	it('og:url不一致でも実効閾値が半分(切り上げ)になる', () => {
		const tracker = new DedupeCapTracker({ cap: 5, mapCap: 100 });

		tracker.observe(observation({ bodyHash: Buffer.from('b1'), ogUrlMismatch: true }));
		expect(
			tracker.observe(observation({ bodyHash: Buffer.from('b2'), ogUrlMismatch: true })),
		).toBeNull();
		const capped = tracker.observe(
			observation({ bodyHash: Buffer.from('b3'), ogUrlMismatch: true }),
		);
		expect(capped?.effectiveThreshold).toBe(3);
		expect(capped?.observedCount).toBe(3);
	});

	it('body_hash一致とog:url不一致が重なるとさらに閾値が下がる', () => {
		const tracker = new DedupeCapTracker({ cap: 5, mapCap: 100 });
		const bodyHash = Buffer.from('same-body');

		// 1回目: スロット作成（count=1）
		tracker.observe(observation({ bodyHash, ogUrlMismatch: true }));
		// 2回目: bodyHash一致 + og:url不一致 → 閾値 ceil(ceil(5/2)/2) = ceil(3/2) = 2、count=2 >= 2 → cap
		const capped = tracker.observe(observation({ bodyHash, ogUrlMismatch: true }));
		expect(capped?.effectiveThreshold).toBe(2);
		expect(capped?.observedCount).toBe(2);
	});

	it('mapCapを超えて追加してもstateサイズはmapCapを超えない（決定的アサート）', () => {
		const tracker = new DedupeCapTracker({ cap: 100_000, mapCap: 100 });
		for (let i = 0; i < 150; i++) {
			tracker.observe(
				observation({
					shapeKey: `shape-${i}`,
					metaSig: `sig-${i}`,
					bodyHash: Buffer.from(`b${i}`),
				}),
			);
		}
		expect(tracker.size).toBeLessThanOrEqual(100);
		expect(tracker.size).toBe(100);
	});

	it('mapCap超過時は最も古いshapeがLRU的に追い出される', () => {
		const tracker = new DedupeCapTracker({ cap: 2, mapCap: 2 });

		tracker.observe(observation({ shapeKey: 'shapeA', metaSig: 'A' }));
		tracker.observe(observation({ shapeKey: 'shapeB', metaSig: 'B' }));
		// shapeC の挿入で mapCap(2) を超えるため、最も古い shapeA が追い出される
		tracker.observe(observation({ shapeKey: 'shapeC', metaSig: 'C' }));
		expect(tracker.size).toBe(2);

		// shapeA は追い出されているので、再度観測すると新規スロット(count=1)から始まる
		const firstAfterEviction = tracker.observe(
			observation({ shapeKey: 'shapeA', metaSig: 'A' }),
		);
		expect(firstAfterEviction).toBeNull();
		const secondAfterEviction = tracker.observe(
			observation({ shapeKey: 'shapeA', metaSig: 'A' }),
		);
		expect(secondAfterEviction?.observedCount).toBe(2);
	});

	it('preloadedStickyでコンストラクタ時にcapped済みとして扱える', () => {
		const tracker = new DedupeCapTracker({ cap: 5, mapCap: 100 }, ['preloaded-shape']);
		expect(tracker.isCapped('preloaded-shape')).toBe(true);
		expect(tracker.stickyCount).toBe(1);
		expect(tracker.observe(observation({ shapeKey: 'preloaded-shape' }))).toBeNull();
		expect(tracker.stickyCount).toBe(1);
	});
});
