/** Options controlling the opt-in same-cluster soft cap (`--dedupe-cap` / `--dedupe-map-cap`). */
export interface DedupeCapOptions {
	/** Base Misra-Gries majority-vote threshold, before confidence-signal halving. */
	cap: number;
	/** Hard cap on the number of distinct shapes tracked at once; the least-recently-touched shape is evicted beyond this. */
	mapCap: number;
}

/** Per-shape Misra-Gries majority-vote slot. */
export interface DedupeSlot {
	/** The dominant meta signature currently "winning" for this shape. */
	metaSig: string;
	/** Majority-vote counter: incremented on a matching `metaSig`, decremented otherwise. Never exceeds the true count of matching observations. */
	count: number;
	/** The `computeBodyHash` result recorded when this slot was (re)created. */
	bodyHash: Buffer;
}

/**
 * One page's observation fed into `DedupeCapTracker#observe`. Callers are
 * responsible for excluding pages with no signal (empty `computeMetaSignature`
 * result, external, or metadata-only) before constructing this — the tracker
 * itself does not special-case them.
 */
export interface DedupeCapObservation {
	/** The page's URL shape key (see `computeShapeKey`). */
	shapeKey: string;
	/** The page's meta signature (see `computeMetaSignature`). */
	metaSig: string;
	/** The page's `computeBodyHash` result. */
	bodyHash: Buffer;
	/** Whether the page's (absolutised) `og:url` differs from its own URL (see `resolveOgUrlMismatch`). */
	ogUrlMismatch: boolean;
	/** The page's own URL — recorded as the resulting event's `sampleUrl` if this observation caps the shape. */
	url: string;
}

/** Emitted the moment a shape's effective threshold is first reached. */
export interface DedupeCapEvent {
	shapeKey: string;
	sampleUrl: string;
	bodyHash: Buffer;
	effectiveThreshold: number;
	observedCount: number;
}
