import type {
	DedupeCapEvent,
	DedupeCapObservation,
	DedupeCapOptions,
	DedupeSlot,
} from './types.js';

import { isShapeCapped } from './is-shape-capped.js';

/**
 * Tracks, per URL shape, whether the crawl has run into a same-metadata
 * cluster trap (a pager/query-parameter trap the site keeps serving 2xx
 * for), and confirms it via a Misra-Gries majority-vote counter rather than
 * a plain observation count.
 *
 * **Why Misra-Gries (one slot per shape) instead of a multi-layer memory
 * design (issue #208's original proposal)**: a single `{ metaSig, count }`
 * slot per shape can never overcount — `count` is a lower bound on the true
 * number of matching observations, so false-positive cap firing is
 * structurally impossible regardless of how many unrelated legit pages
 * share a shape (e.g. `/product/{id}` with thousands of genuinely distinct
 * pages). This makes most of that original proposal's eviction machinery
 * unnecessary: age-based eviction and "parent-path bucket completion"
 * eviction both exist there only to bound memory for a naive
 * `Map<sig, count>`, which this design never needs since it holds at most
 * one slot per *shape* (not per signature-per-shape). Only "cap-reached
 * sticky migration" (`#sticky`) and "hard map cap with LRU eviction"
 * (`mapCap`) remain relevant here.
 *
 * **Known limitation (accepted, not fixed)**: Misra-Gries (k=1) can only
 * detect a *strict majority* signature. If a trap alternates between two
 * near-equally-frequent `metaSig` values for the same shape (e.g. an
 * even/odd-year template split), `count` oscillates near zero and the cap
 * never fires. A total-observation-count backstop was considered and
 * rejected: it would misfire on legitimate large sections (e.g. a
 * `/product/{id}` catalogue with thousands of distinct, correctly-unique
 * pages sharing one shape). Because arrival order under concurrent
 * crawling is non-deterministic, whether this alternating-signature case
 * fires is itself non-deterministic — test fixtures for this tracker use a
 * single dominant `metaSig` per shape to keep results deterministic.
 *
 * **Rejected alternative — top-K "space-saving" per shape**: keeping the
 * top K=4 `{metaSig, count}` candidates per shape (instead of one) was
 * considered so a shape could distinguish more than one competing
 * signature. Rejected because eviction semantics have no safe default: if
 * an evicted candidate's count is inherited by its replacement (the
 * textbook space-saving guarantee), churn through a large legitimate
 * section (e.g. thousands of distinct `/product/{id}` pages sharing one
 * shape) inflates an unrelated candidate's inherited count and can
 * false-positive cap it; if not inherited, a genuine trap can be evicted
 * before it accumulates enough count, producing a false negative. A single
 * majority-vote slot per shape has neither failure mode.
 *
 * **Rejected alternative — streak counting** (increment on a match with the
 * immediately preceding observation, reset to zero otherwise): fails the
 * same way under concurrent crawling as the alternating-signature case
 * above — a trap and an unrelated same-shape legit page interleaving resets
 * the streak before it can reach the cap.
 * @see {@link https://en.wikipedia.org/wiki/Boyer%E2%80%93Moore_majority_vote_algorithm} for the underlying algorithm (Misra-Gries generalises it to top-K; this uses K=1).
 */
export default class DedupeCapTracker {
	readonly #options: DedupeCapOptions;
	readonly #state = new Map<string, DedupeSlot>();
	readonly #sticky: Set<string>;

	/** Number of distinct shapes currently held in the (non-sticky) state map. Exposed for the `mapCap` bound assertion in tests. */
	get size(): number {
		return this.#state.size;
	}
	/** Number of shapes confirmed capped (sticky) so far. */
	get stickyCount(): number {
		return this.#sticky.size;
	}
	/**
	 * @param options - `--dedupe-cap` / `--dedupe-map-cap` thresholds.
	 * @param preloadedSticky - Shape keys already confirmed capped in a prior
	 *   session (from `dedupe_cap_events.shape_key`), seeded so `--resume` /
	 *   `--append` / `--retry-failed` / `--inventory` do not re-admit a trap
	 *   this crawl already paid the cost of discovering once.
	 */
	constructor(options: DedupeCapOptions, preloadedSticky: Iterable<string> = []) {
		this.#options = options;
		this.#sticky = new Set(preloadedSticky);
	}

	/**
	 * Whether a shape has already been confirmed capped. Callers gate
	 * enqueue decisions on this before ever calling {@link observe}.
	 * @param shapeKey
	 */
	isCapped(shapeKey: string): boolean {
		return isShapeCapped(this.#sticky, shapeKey);
	}

	/**
	 * Registers one page's observation and applies the Misra-Gries
	 * majority-vote update for its shape.
	 * @param observation - See {@link DedupeCapObservation}. Callers must not
	 *   call this for a shape that is already capped (check {@link isCapped}
	 *   first) — doing so is a no-op returning `null`, since the shape's slot
	 *   was already dropped from `#state` when it capped.
	 * @returns A {@link DedupeCapEvent} the instant this observation causes
	 *   the shape to newly cross its effective threshold, otherwise `null`.
	 */
	observe(observation: DedupeCapObservation): DedupeCapEvent | null {
		const { shapeKey, metaSig, bodyHash, ogUrlMismatch, url } = observation;
		if (this.#sticky.has(shapeKey)) return null;

		const existing = this.#state.get(shapeKey);
		let slot: DedupeSlot;
		// The body-hash confidence signal only means something when compared
		// against a hash a PRIOR observation already recorded for this shape —
		// comparing a freshly-created (or just-reset) slot's `bodyHash`
		// against itself would trivially "match" every single time (it is the
		// same value), collapsing the threshold on the very first
		// observation of any shape. So this stays `false` whenever the slot
		// has no observation history to compare against yet.
		let bodyHashMatches: boolean;
		if (!existing) {
			slot = { metaSig, count: 1, bodyHash };
			bodyHashMatches = false;
		} else if (existing.metaSig === metaSig) {
			existing.count++;
			bodyHashMatches = existing.bodyHash.equals(bodyHash);
			// Track the most recently observed body for this shape, not the
			// one recorded when the slot was first created — otherwise a
			// shape whose first page differs from an otherwise-identical run
			// of later pages (e.g. a one-off warmup response) would compare
			// every later page against that stale first hash forever and
			// never see a match.
			existing.bodyHash = bodyHash;
			slot = existing;
		} else {
			existing.count--;
			if (existing.count <= 0) {
				slot = { metaSig, count: 1, bodyHash };
			} else {
				slot = existing;
			}
			bodyHashMatches = false;
		}
		// Re-insert to move this shape to the "most recently touched" end of
		// the Map's iteration order, which `#enforceHardCap` relies on to
		// evict the least-recently-touched shape first.
		this.#state.delete(shapeKey);
		this.#state.set(shapeKey, slot);

		const effectiveThreshold = computeEffectiveThreshold(
			this.#options.cap,
			bodyHashMatches,
			ogUrlMismatch,
		);

		if (slot.count >= effectiveThreshold) {
			this.#state.delete(shapeKey);
			this.#sticky.add(shapeKey);
			return {
				shapeKey,
				sampleUrl: url,
				bodyHash,
				effectiveThreshold,
				observedCount: slot.count,
			};
		}

		this.#enforceHardCap();
		return null;
	}

	/**
	 * Evicts the least-recently-touched shape(s) until `#state` is back
	 * within `mapCap`. This is the pathological-case backstop — under normal
	 * operation the Misra-Gries design keeps `#state` bounded by the number
	 * of distinct shapes actually seen, which rarely approaches `mapCap`.
	 */
	#enforceHardCap(): void {
		while (this.#state.size > this.#options.mapCap) {
			const oldestKey = this.#state.keys().next().value;
			if (oldestKey === undefined) break;
			this.#state.delete(oldestKey);
		}
	}
}

/**
 * Computes the effective same-cluster cap threshold: the base `--dedupe-cap`
 * value, halved independently for each confidence signal present (a
 * matching `body_hash` and an `og:url` that does not point at the page
 * itself), rounded up so the threshold never reaches zero.
 * @param baseCap
 * @param bodyHashMatches
 * @param ogUrlMismatch
 */
function computeEffectiveThreshold(
	baseCap: number,
	bodyHashMatches: boolean,
	ogUrlMismatch: boolean,
): number {
	let threshold = baseCap;
	if (bodyHashMatches) threshold = Math.ceil(threshold / 2);
	if (ogUrlMismatch) threshold = Math.ceil(threshold / 2);
	return Math.max(threshold, 1);
}
