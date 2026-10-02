import type { AssignTemplateLabelsParams, TemplateLabel } from './types.js';

/**
 * Assigns every cluster of a fresh template classification its
 * {@link TemplateLabel}, carrying labels forward from the previous
 * classification wherever the same template survived the re-run.
 *
 * ## Inheritance
 *
 * A new cluster inherits an old cluster's label when the two share a
 * **mutual majority** of pages: the overlap is more than half of the new
 * cluster *and* more than half of the old one. Mutual majority means at
 * most one new cluster can claim a given old label, and a cluster that
 * merely absorbed a few pages of a much larger old template does not steal
 * its name. A split keeps the old label on the half that holds most of the
 * old pages; the other half is named afresh.
 *
 * The old cluster's size counts only pages that are classified in the new
 * run too. Pages the crawl has since dropped (`--recrawl` turned them into
 * redirects, errors, …) are not evidence that the template changed, so
 * they must not dilute the old half of the majority — otherwise an old
 * 7-page cluster whose 4 missing pages left 3 unchanged ones would fail
 * `3 > 7/2` and be renamed for no reason.
 *
 * Page ids are the identity used for overlap (not URLs) because they are
 * what `page_templates` stores and they survive `--append` / `--recrawl`
 * without renumbering.
 *
 * ## Fresh labels
 *
 * Clusters left without an inherited label are numbered in page-count
 * order (largest first, template key as a tie-break) so a first run reads
 * naturally: `A` is the section's biggest template. Each takes the next
 * ordinal **after every ordinal in `previousLabels` for its section**, so a
 * letter is never re-issued to a different template — which would silently
 * change what "events template B" means between two people's archives.
 * That guarantee is only as good as `previousLabels`: `replacePageTemplates`
 * keeps the rows of clusters that disappeared (retired labels) precisely so
 * they stay in this set across any number of later runs.
 *
 * ## Section
 *
 * A cluster's section is the first path segment every member URL shares
 * (`events` for `/events/...`). Members spread over several segments, or
 * all at the site root, yield `null`: such a cluster is numbered in the
 * site-wide sequence. An inherited label keeps its old section even if the
 * cluster's members have since drifted — stability of the name wins over
 * keeping the section literally accurate.
 * @param params - See {@link AssignTemplateLabelsParams}.
 * @returns Template key → label, one entry per cluster in `params.clusters`.
 * @example
 * ```ts
 * const labels = assignTemplateLabels({
 *   clusters: new Map([['["path:events","cluster:0"]', { pageIds: [1, 2], urls: ['https://example.com/events/a', 'https://example.com/events/b'] }]]),
 *   previousMembership: new Map(),
 *   previousLabels: new Map(),
 * });
 * labels.get('["path:events","cluster:0"]'); // { section: 'events', ordinal: 1 }
 * ```
 */
export function assignTemplateLabels(
	params: AssignTemplateLabelsParams,
): Map<string, TemplateLabel> {
	const { clusters, previousMembership, previousLabels } = params;

	const currentPageIds = new Set<number>();
	for (const cluster of clusters.values()) {
		for (const pageId of cluster.pageIds) {
			currentPageIds.add(pageId);
		}
	}
	const previousKeyByPageId = new Map<number, string>();
	const previousSizeByKey = new Map<string, number>();
	for (const [key, pageIds] of previousMembership) {
		let size = 0;
		for (const pageId of pageIds) {
			previousKeyByPageId.set(pageId, key);
			if (currentPageIds.has(pageId)) {
				size += 1;
			}
		}
		previousSizeByKey.set(key, size);
	}

	// Every ordinal ever issued per section, seeded from the previous run so
	// a vanished cluster's letter is retired rather than re-issued.
	const usedOrdinals = new Map<string | null, Set<number>>();
	const markUsed = (label: TemplateLabel) => {
		let set = usedOrdinals.get(label.section);
		if (!set) {
			set = new Set();
			usedOrdinals.set(label.section, set);
		}
		set.add(label.ordinal);
	};
	for (const label of previousLabels.values()) {
		markUsed(label);
	}

	const ordered = [...clusters].toSorted(
		([keyA, a], [keyB, b]) =>
			b.pageIds.length - a.pageIds.length || keyA.localeCompare(keyB),
	);

	const labels = new Map<string, TemplateLabel>();
	const claimedPreviousKeys = new Set<string>();
	const unlabeled: typeof ordered = [];
	for (const entry of ordered) {
		const [key, cluster] = entry;
		const inherited = findInheritedLabel(cluster.pageIds, {
			previousKeyByPageId,
			previousSizeByKey,
			previousLabels,
			claimedPreviousKeys,
		});
		if (inherited) {
			claimedPreviousKeys.add(inherited.previousKey);
			labels.set(key, inherited.label);
		} else {
			unlabeled.push(entry);
		}
	}

	for (const [key, cluster] of unlabeled) {
		const section = deriveSection(cluster.urls);
		const used = usedOrdinals.get(section);
		const ordinal = used ? Math.max(...used) + 1 : 1;
		const label: TemplateLabel = { section, ordinal };
		markUsed(label);
		labels.set(key, label);
	}

	return labels;
}

/**
 * Finds the previous cluster whose label the given members inherit, if any
 * — the unclaimed, labeled previous cluster sharing a mutual majority of
 * pages with them.
 * @param pageIds - The new cluster's member page ids.
 * @param context - Lookups built once by `assignTemplateLabels`.
 * @param context.previousKeyByPageId - Page id → previous template key.
 * @param context.previousSizeByKey - Previous template key → member count.
 * @param context.previousLabels - Previous template key → label.
 * @param context.claimedPreviousKeys - Previous keys already inherited by a larger new cluster.
 * @returns The matched previous key and its label, or `null`.
 */
function findInheritedLabel(
	pageIds: readonly number[],
	context: {
		previousKeyByPageId: ReadonlyMap<number, string>;
		previousSizeByKey: ReadonlyMap<string, number>;
		previousLabels: ReadonlyMap<string, TemplateLabel>;
		claimedPreviousKeys: ReadonlySet<string>;
	},
): { previousKey: string; label: TemplateLabel } | null {
	const overlapByKey = new Map<string, number>();
	for (const pageId of pageIds) {
		const previousKey = context.previousKeyByPageId.get(pageId);
		if (previousKey != null) {
			overlapByKey.set(previousKey, (overlapByKey.get(previousKey) ?? 0) + 1);
		}
	}
	let best: { previousKey: string; overlap: number } | null = null;
	for (const [previousKey, overlap] of overlapByKey) {
		if (!best || overlap > best.overlap) {
			best = { previousKey, overlap };
		}
	}
	if (!best || context.claimedPreviousKeys.has(best.previousKey)) {
		return null;
	}
	const label = context.previousLabels.get(best.previousKey);
	if (!label) {
		return null;
	}
	const previousSize = context.previousSizeByKey.get(best.previousKey) ?? 0;
	if (best.overlap * 2 <= pageIds.length || best.overlap * 2 <= previousSize) {
		return null;
	}
	return { previousKey: best.previousKey, label };
}

/**
 * The first path segment shared by every URL, or `null` when they disagree
 * or all sit at the site root. A URL that fails to parse counts as
 * disagreeing — a cluster is not pinned to a section by guesswork.
 * @param urls - The cluster's member page URLs.
 * @returns The shared section name, or `null`.
 */
function deriveSection(urls: readonly string[]): string | null {
	let section: string | null | undefined;
	for (const url of urls) {
		let segment: string;
		try {
			segment = new URL(url).pathname.split('/')[1] ?? '';
		} catch {
			return null;
		}
		if (section === undefined) {
			section = segment;
		} else if (section !== segment) {
			return null;
		}
	}
	return section || null;
}
