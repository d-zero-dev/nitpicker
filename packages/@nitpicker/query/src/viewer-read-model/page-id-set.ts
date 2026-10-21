/**
 * Smallest number of ids held in the hash set before the set is even
 * considered for conversion to a bitmap (small sets stay small either way).
 */
const MIN_ENTRIES_BEFORE_BITMAP = 64;

/**
 * Bytes one `Set<number>` entry takes in V8, rounded up from the measurement
 * (`process.memoryUsage().heapUsed` after a forced GC, over a few hundred sets
 * of 3,600 to 14,400 small integers: 22 to 23 bytes per entry). A bitmap over
 * `capacity` pages takes `capacity / 8` bytes, so the two cost the same at
 * `capacity / 8 / 23` entries. Measure again the same way if this ever needs
 * to follow a change in V8's hash set.
 */
const SET_BYTES_PER_ENTRY = 24;

/**
 * An exact set of page ids that costs `O(entries)` while it is small and a
 * fixed `capacity / 8` bytes once it is large, so a group that every page on
 * a 500K-page site refers to is held as a bitmap, not as hundreds of
 * thousands of `Set` entries.
 *
 * Why exact, not approximate: the count it reports is persisted
 * (`viewer_resource_groups.referrer_count`) and must equal the number of
 * distinct referring pages. Why not a bitmap from the start: most groups have
 * a handful of referrers, and one `capacity / 8`-byte buffer per group would
 * cost far more than the `Set` a small group needs (there are tens of
 * thousands of groups).
 *
 * An id the bitmap cannot index (at or above `capacity`, negative or not an
 * integer) is never rejected: it stays in the hash set for the life of the
 * instance, so the count is still exact.
 * @example
 * const referrers = new PageIdSet(maxContentItemId + 1);
 * if (referrers.add(edge.pageId)) {
 *   samples.push(edge.pageId); // first time this page refers to the group
 * }
 * referrers.size; // distinct referring pages
 */
export class PageIdSet {
	#bitCount = 0;
	/** One bit per id below `capacity`; `undefined` until the set grows past the switch point. */
	#bits: Uint8Array | undefined;
	readonly #capacity: number;
	/** Ids held as hash entries: every id until the switch, ids the bitmap cannot index afterwards. */
	#entries = new Set<number>();
	readonly #switchAt: number;

	/** The number of distinct ids added so far. */
	get size(): number {
		return this.#entries.size + this.#bitCount;
	}
	/** Whether the set has grown past the switch point and holds its ids as a bitmap. */
	get isBitmap(): boolean {
		return this.#bits !== undefined;
	}
	/**
	 * @param capacity - One more than the largest page id the archive holds.
	 */
	constructor(capacity: number) {
		this.#capacity = capacity;
		this.#switchAt = Math.max(
			MIN_ENTRIES_BEFORE_BITMAP,
			Math.ceil(capacity / 8 / SET_BYTES_PER_ENTRY),
		);
	}

	/**
	 * Adds an id.
	 * @param id - A page id.
	 * @returns `true` when the id was not in the set before.
	 */
	add(id: number): boolean {
		const bits = this.#bits;
		if (bits && this.#isIndexable(id)) {
			const byte = id >>> 3;
			const mask = 1 << (id & 7);
			if (bits[byte]! & mask) {
				return false;
			}
			bits[byte]! |= mask;
			this.#bitCount += 1;
			return true;
		}
		if (this.#entries.has(id)) {
			return false;
		}
		this.#entries.add(id);
		if (!bits && this.#entries.size > this.#switchAt && this.#capacity > 0) {
			this.#moveToBitmap();
		}
		return true;
	}

	/**
	 * Whether the bitmap has a bit for `id`.
	 * @param id - A page id.
	 */
	#isIndexable(id: number): boolean {
		return Number.isInteger(id) && id >= 0 && id < this.#capacity;
	}

	/** Moves every id the bitmap can index from the hash set into a new bitmap. */
	#moveToBitmap(): void {
		const bits = new Uint8Array((this.#capacity + 7) >>> 3);
		for (const id of this.#entries) {
			if (this.#isIndexable(id)) {
				bits[id >>> 3]! |= 1 << (id & 7);
				this.#bitCount += 1;
				this.#entries.delete(id);
			}
		}
		if (this.#entries.size === 0) {
			// Deleting entries one by one can leave the hash table at its grown
			// size; a fresh `Set` returns that memory.
			this.#entries = new Set();
		}
		this.#bits = bits;
	}
}
