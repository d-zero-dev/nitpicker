import type { ArchiveAccessor } from '@nitpicker/crawler';

import { computeTierAAliasKey, computeTierBAliasKey } from '@nitpicker/crawler';

const CHUNK_SIZE = 500;

/**
 * ASCII Unit Separator — joins bucket-key parts (URL-derived key, title id,
 * body-hash hex) unambiguously. A raw `::` would risk two distinct
 * `(key, title)` pairs colliding into the same string if a URL path
 * legitimately contains `:` (RFC 3986 allows it in path segments); `\x1F` is
 * illegal in URLs, matching the same delimiter choice `find-duplicates.ts`
 * uses for its `GROUP_CONCAT` split.
 */
const BUCKET_KEY_DELIMITER = '';

interface AliasCandidate {
	id: number;
	url: string;
	titleTextId: number;
	bodyHash: Buffer | null;
	canonicalUrl: string | null;
}

/**
 * Minimal union-find (disjoint-set) over `content_items.id` values, used to
 * take the transitive closure of "same Tier A key" and "same Tier B key"
 * edges into connected components. See {@link backfillAliasOfId}'s JSDoc for
 * why this closure step is required for transitivity.
 */
class UnionFind {
	readonly #parent = new Map<number, number>();

	find(x: number): number {
		if (!this.#parent.has(x)) {
			this.#parent.set(x, x);
			return x;
		}
		// Every value ever stored in `#parent` is itself a key that was (or
		// will be, by the time it's looked up) registered via this same
		// `has`-guarded path, so `.get(...)` below is always defined for a
		// key reached by walking from a registered `x`.
		let root = x;
		while (this.#parent.get(root) !== root) {
			root = this.#parent.get(root)!;
		}
		let current = x;
		while (current !== root) {
			const next = this.#parent.get(current)!;
			this.#parent.set(current, root);
			current = next;
		}
		return root;
	}

	union(a: number, b: number): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA !== rootB) {
			this.#parent.set(rootA, rootB);
		}
	}
}

/**
 * Unions every id within a key-grouped bucket to the bucket's first member,
 * for every bucket with more than one member. This is what turns "same key"
 * into graph edges for {@link UnionFind} to take the connected-component
 * closure of.
 * @param uf - The union-find structure to union members into.
 * @param buckets - Map of key to the candidate ids sharing that key.
 */
function unionBuckets(uf: UnionFind, buckets: Map<string, number[]>): void {
	for (const bucket of buckets.values()) {
		for (let i = 1; i < bucket.length; i++) {
			uf.union(bucket[0]!, bucket[i]!);
		}
	}
}

/**
 * Elects the representative member of an alias group (the survivor
 * `alias_of_id` target every other member points at).
 *
 * Preference order: a member whose URL is pointed at by the most in-group
 * `<link rel="canonical">` declarations (see {@link backfillAliasOfId}'s
 * JSDoc for why "any in-group target," not just self-canonical, counts);
 * otherwise the shortest URL string. Ties at either stage break on
 * ascending string comparison, so the choice is fully deterministic across
 * repeated runs — required for the idempotency the caller's full-recompute
 * design otherwise couldn't guarantee.
 * @param group - The alias group's members (size >= 2).
 * @returns The elected representative.
 */
function selectRepresentative(group: readonly AliasCandidate[]): AliasCandidate {
	const memberUrls = new Set(group.map((m) => m.url));
	const canonicalPointerCounts = new Map<string, number>();
	for (const member of group) {
		if (member.canonicalUrl !== null && memberUrls.has(member.canonicalUrl)) {
			canonicalPointerCounts.set(
				member.canonicalUrl,
				(canonicalPointerCounts.get(member.canonicalUrl) ?? 0) + 1,
			);
		}
	}

	const rank = (member: AliasCandidate): number =>
		canonicalPointerCounts.get(member.url) ?? 0;
	const pool =
		canonicalPointerCounts.size > 0 ? group.filter((member) => rank(member) > 0) : group;

	let best = pool[0]!;
	for (const current of pool.slice(1)) {
		const bestRank = rank(best);
		const currentRank = rank(current);
		if (currentRank !== bestRank) {
			best = currentRank > bestRank ? current : best;
		} else if (current.url.length !== best.url.length) {
			best = current.url.length < best.url.length ? current : best;
		} else if (current.url < best.url) {
			best = current;
		}
	}
	return best;
}

/**
 * Recomputes `content_items.alias_of_id` for the whole archive: groups
 * pages that are the same underlying resource under URL-normalization
 * (Tier A: scheme/host-case/`index.{ext}`-suffix variance) or a
 * body-hash-confirmed trailing-slash variance (Tier B), and points every
 * non-representative member of each group at the elected representative.
 *
 * **Transitivity**: Tier A and Tier B are each a canonical-key function
 * (`computeTierAAliasKey`/`computeTierBAliasKey`) — grouping by exact key
 * equality is definitionally an equivalence relation. But the *union* of two
 * different equivalence relations (a page linked to another via Tier A, and
 * to a third via Tier B) is not automatically transitive on its own. This
 * function closes that gap explicitly with union-find: every Tier A bucket
 * and every Tier B bucket contributes "same group" edges, and the
 * connected components of that combined edge set are — by the graph-theory
 * definition of a connected component — always a transitive partition. See
 * ARCHITECTURE.md's "URL natural-sort comparator は推移律を保証しない" for
 * the pairwise-comparator failure mode this design avoids.
 *
 * **`title_text_id` gate**: both tiers additionally require the candidate
 * rows to share the same `page_meta.title_text_id` — a page whose title
 * differs is never merged, regardless of how strong the URL/body signal is.
 * Candidates with a `NULL` title are excluded from the query entirely (not
 * bucketed), so two title-less pages never spuriously merge on a `null ===
 * null` grouping key.
 *
 * **Full recompute, not backfill-only**: unlike `backfillBodyHashFromHtmlBlobs`
 * (which only ever fills a `NULL` cell), this function resets every existing
 * `alias_of_id` to `NULL` and recomputes the whole archive on every call.
 * A backfill-only design cannot react correctly to a newly-crawled page
 * joining an existing group (it might become the new shortest-URL or
 * self-canonical representative) or to an existing group's membership
 * changing across `crawl --append`/`--resume`. Recomputing the whole
 * candidate set each time is idempotent and always reflects the archive's
 * current state.
 * @param accessor - Writable archive accessor.
 * @param onProgress - Optional callback invoked after each write chunk with
 *   `(processed, total)` counts, for archives large enough that visible
 *   progress matters.
 * @example
 * await backfillAliasOfId(accessor, (processed, total) => {
 *   console.error(`alias_of_id backfill: ${processed}/${total}`);
 * });
 */
export async function backfillAliasOfId(
	accessor: ArchiveAccessor,
	onProgress?: (processed: number, total: number) => void,
): Promise<void> {
	const knex = accessor.getKnex();

	const candidates = (await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.join('page_meta as pm', 'pm.page_id', 'ci.id')
		.leftJoin('url_refs as canonical_ur', 'canonical_ur.id', 'pm.canonical_url_id')
		.where({ 'ci.scraped': 1, 'ci.is_external': 0 })
		.whereNull('ci.redirect_dest_id')
		.whereNotNull('pm.title_text_id')
		.select(
			'ci.id as id',
			'ur.url as url',
			'pm.title_text_id as titleTextId',
			'pm.body_hash as bodyHash',
			'canonical_ur.url as canonicalUrl',
		)) as {
		id: number;
		url: string;
		titleTextId: number;
		bodyHash: Uint8Array | null;
		canonicalUrl: string | null;
	}[];

	// Reset first so a group that shrinks or reshuffles never leaves a
	// stale pointer from a previous run — every write below is therefore
	// always into an already-NULL cell.
	await knex('content_items').whereNotNull('alias_of_id').update({ alias_of_id: null });

	if (candidates.length === 0) {
		return;
	}

	const normalized: AliasCandidate[] = candidates.map((row) => ({
		id: row.id,
		url: row.url,
		titleTextId: row.titleTextId,
		bodyHash: row.bodyHash ? Buffer.from(row.bodyHash) : null,
		canonicalUrl: row.canonicalUrl,
	}));

	const uf = new UnionFind();
	const tierABuckets = new Map<string, number[]>();
	const tierBBuckets = new Map<string, number[]>();

	for (const candidate of normalized) {
		uf.find(candidate.id);

		const tierAKey = computeTierAAliasKey(candidate.url);
		if (tierAKey !== null) {
			const bucketKey = `${tierAKey}${BUCKET_KEY_DELIMITER}${candidate.titleTextId}`;
			const bucket = tierABuckets.get(bucketKey);
			if (bucket) {
				bucket.push(candidate.id);
			} else {
				tierABuckets.set(bucketKey, [candidate.id]);
			}
		}

		if (candidate.bodyHash !== null) {
			const tierBKey = computeTierBAliasKey(candidate.url);
			if (tierBKey !== null) {
				const bucketKey = `${tierBKey}${BUCKET_KEY_DELIMITER}${candidate.titleTextId}${BUCKET_KEY_DELIMITER}${candidate.bodyHash.toString('hex')}`;
				const bucket = tierBBuckets.get(bucketKey);
				if (bucket) {
					bucket.push(candidate.id);
				} else {
					tierBBuckets.set(bucketKey, [candidate.id]);
				}
			}
		}
	}

	unionBuckets(uf, tierABuckets);
	unionBuckets(uf, tierBBuckets);

	const groups = new Map<number, AliasCandidate[]>();
	for (const candidate of normalized) {
		const root = uf.find(candidate.id);
		const group = groups.get(root);
		if (group) {
			group.push(candidate);
		} else {
			groups.set(root, [candidate]);
		}
	}

	const assignments: { memberId: number; representativeId: number }[] = [];
	for (const group of groups.values()) {
		if (group.length < 2) {
			continue;
		}
		const representative = selectRepresentative(group);
		for (const member of group) {
			if (member.id !== representative.id) {
				assignments.push({ memberId: member.id, representativeId: representative.id });
			}
		}
	}

	const total = assignments.length;
	if (total === 0) {
		return;
	}

	let processed = 0;
	for (let start = 0; start < assignments.length; start += CHUNK_SIZE) {
		const chunk = assignments.slice(start, start + CHUNK_SIZE);
		await knex.transaction(async (trx) => {
			for (const assignment of chunk) {
				await trx('content_items')
					.where('id', assignment.memberId)
					.update({ alias_of_id: assignment.representativeId });
			}
		});
		processed += chunk.length;
		onProgress?.(processed, total);
	}
}
