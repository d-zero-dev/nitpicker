import type { GoldenRecord } from './types.js';
import type { ClusterReason } from '../page-cluster/build-cluster-reason.js';
import type { PageClusterSignals } from '../page-cluster/resolve-page-cluster-keys.js';

import { createHash } from 'node:crypto';

import { serializeTemplateClusterReason } from '../../db-ops/templates/serialize-template-cluster-reason.js';
import { resolvePageClusterKeys } from '../page-cluster/resolve-page-cluster-keys.js';

/**
 * Classifies a golden corpus the way `classifyPageTemplates` does in
 * production — with an `onProgress` callback, which is what the CLI always
 * passes and which selects the progress-emitting small-corpus driver — and
 * returns the result in its committed form. The reason strings come from
 * the serializer `replacePageTemplates` stores with, so the golden pins the
 * persisted text, floats included.
 *
 * The corpus is handed to the engine as signals directly: the archive-side
 * adapters (`createPageClusterFactory`, `createContentRootHint`,
 * `collectPageStylesheetUrls`, the URL ↔ key mapping in
 * `classifyPageTemplates`) are not exercised here — they have their own
 * specs, and `scripts/template-classification-golden.mjs` runs the whole
 * production path on real archives.
 * @param pages - The corpus.
 * @returns The record to compare against `__golden__/`.
 * @example
 * ```ts
 * const record = await classifyGoldenCorpus(buildSyntheticSite({ seed: 1, scale: 1 }));
 * ```
 */
export async function classifyGoldenCorpus(
	pages: readonly PageClusterSignals[],
): Promise<GoldenRecord> {
	const reasons = new Map<string, ClusterReason>();
	const keys = await resolvePageClusterKeys(() => pages, {
		onProgress: () => {},
		onClusterReason: (clusterKey, reason) => {
			reasons.set(clusterKey, reason);
		},
	});

	const templateKeys: string[] = [];
	const indexByKey = new Map<string, number>();
	const templateKeyIndexByPage = keys.map((key) => {
		let index = indexByKey.get(key);
		if (index === undefined) {
			index = templateKeys.length;
			indexByKey.set(key, index);
			templateKeys.push(key);
		}
		return index;
	});

	const clusterReasonJsonByTemplateKey: Record<string, string> = {};
	// Default sort: UTF-16 code-unit order, independent of locale.
	for (const key of [...reasons.keys()].toSorted()) {
		const reason = reasons.get(key);
		if (reason) {
			clusterReasonJsonByTemplateKey[key] = serializeTemplateClusterReason(reason);
		}
	}

	const digest = createHash('sha256');
	for (const page of pages) {
		digest.update(`${JSON.stringify(page)}\n`);
	}

	return {
		inputDigest: digest.digest('hex'),
		pageCount: pages.length,
		templateKeys,
		templateKeyIndexByPage,
		clusterReasonJsonByTemplateKey,
	};
}
