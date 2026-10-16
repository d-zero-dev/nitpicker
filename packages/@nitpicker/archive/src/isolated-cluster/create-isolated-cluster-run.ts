import type { IsolatedClusterRun } from '@nitpicker/core/types';

import { createIsolatedClusterRun as createIsolatedClusterRunNative } from '@nitpicker/core/create-isolated-cluster-run';

/**
 * Starts the computation of the connected components of the isolated pages
 * (the inventory pages linked to only from other inventory pages), fed with
 * the link edges as SQLite returns them and never holding them.
 *
 * `@nitpicker/query` reaches the native addon through this archive function
 * (see ARCHITECTURE.md's dependency rule); what an edge counts as, how
 * redirect and alias hops are followed and how the components are numbered
 * are the docs of `createIsolatedClusterRun` in `@nitpicker/core`, which this
 * calls as it is.
 * @param candidateIds - The candidate page ids, in the order the components
 *   are numbered in (ascending page id for the viewer read model's `component_id`).
 * @param redirects - The redirect and alias hops of the whole archive,
 *   `[source, destination, ...]` by page id.
 * @returns The run.
 * @example
 * ```ts
 * const run = createIsolatedClusterRun([10, 20, 30], [40, 30]);
 * run.unionEdges([10, 20, 20, 40]);
 * run.labels(); // Uint32Array [0, 0, 0]
 * ```
 */
export function createIsolatedClusterRun(
	candidateIds: ArrayLike<number>,
	redirects: ArrayLike<number>,
): IsolatedClusterRun {
	return createIsolatedClusterRunNative(candidateIds, redirects);
}
