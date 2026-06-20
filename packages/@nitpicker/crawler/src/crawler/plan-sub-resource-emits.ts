import type { CrawlerEventTypes } from './types.js';
import type { PageSource } from '../archive/types.js';
import type { ResourceEntry } from '@d-zero/beholder';

import { deriveResourceSource } from './derive-resource-source.js';
import { handleResourceResponse } from './handle-resource-response.js';

/**
 * Planned `response` emit produced by {@link planSubResourceEmits}.
 */
export interface PlannedResponseEmit {
	/** The resource payload to attach to the `response` event. */
	resource: CrawlerEventTypes['response']['resource'];
	/**
	 * The `source` field propagated to the `response` event. Resolved from
	 * the parent page's lineage via {@link deriveResourceSource} — pinning
	 * this through a planning step (rather than computing it inline in
	 * `#handleResources`) lets the wire-up be unit-tested without spinning
	 * up the puppeteer mock stack.
	 */
	source: PageSource | undefined;
}

/**
 * Planned `responseReferrers` emit produced by {@link planSubResourceEmits}.
 * Always emitted, regardless of whether the resource is new — `isNew` only
 * gates the `response` event.
 */
export interface PlannedReferrerEmit {
	/** The page URL that triggered the sub-resource fetch. */
	url: string;
	/** The resource URL (hash stripped to match the storage key). */
	src: string;
}

/**
 * Output of {@link planSubResourceEmits}: the deduped `response` plan and
 * the per-resource `responseReferrers` plan, side-by-side.
 */
export interface SubResourceEmitPlan {
	/** `response` events to emit (new resources only). */
	responseEmits: PlannedResponseEmit[];
	/** `responseReferrers` events to emit (every resource, even seen ones). */
	referrerEmits: PlannedReferrerEmit[];
}

/**
 * Decide which sub-resource `response` / `responseReferrers` events the
 * crawler should emit for a page render, with the parent's source lineage
 * baked into every `response` event's `source` field.
 *
 * Pure function — takes the resources captured during the render plus the
 * seen-resource set and the parent's source, returns the emit plan. The
 * caller (`Crawler.#handleResources`) is responsible for iterating the
 * plan through its event emitter. Splitting "decide what to emit" from
 * "actually emit" is what makes the lineage propagation contract
 * unit-testable: the previous shape inlined `emit('response', { ...
 * source: deriveResourceSource(...) })` and could only be exercised via a
 * full scrape with a mocked puppeteer stack, which left the `source`
 * value half of the contract effectively un-pinned.
 *
 * Mutates `seenResources` as a side effect — every captured resource is
 * recorded as seen so the next call dedupes correctly. This mirrors the
 * `Crawler.#resources` Set semantics that the planner is designed to share.
 * @param resources - Sub-resource entries captured during the page render.
 * @param parentSource - Merged source of the page being rendered, as resolved by `Crawler.#resolveParentSource`.
 * @param seenResources - Mutable set of already-seen resource keys (mutated in place).
 * @returns The plan of `response` + `responseReferrers` emits to dispatch.
 */
export function planSubResourceEmits(
	resources: ResourceEntry[],
	parentSource: PageSource | undefined,
	seenResources: Set<string>,
): SubResourceEmitPlan {
	const subResourceSource = deriveResourceSource(parentSource);
	const responseEmits: PlannedResponseEmit[] = [];
	const referrerEmits: PlannedReferrerEmit[] = [];
	for (const { resource, pageUrl } of resources) {
		const { isNew } = handleResourceResponse(
			resource as CrawlerEventTypes['response']['resource'],
			seenResources,
		);
		if (isNew) {
			responseEmits.push({
				resource: resource as CrawlerEventTypes['response']['resource'],
				source: subResourceSource,
			});
		}
		referrerEmits.push({
			url: pageUrl,
			src: resource.url.withoutHash,
		});
	}
	return { responseEmits, referrerEmits };
}
