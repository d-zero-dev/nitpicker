import type { I18nValue } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { formatTemplateLabel } from '../utils/format-template-label.js';

import { buildClusterHeading } from './build-cluster-heading.js';

/**
 * The name a cluster is shown under everywhere on the template clusters
 * view: its label (`events template A`, stored or provisional) when it has
 * one, else the stylesheet/directory heading `buildClusterHeading` derives
 * from its members — which is the only name available for a cluster on an
 * archive whose label table was written only partially.
 * @param cluster - The cluster to name.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The display name.
 * @example
 * ```ts
 * formatClusterName(cluster, t); // 'events template A'
 * ```
 */
export function formatClusterName(
	cluster: TemplateClusterSummary,
	t: I18nValue['t'],
): string {
	return cluster.label
		? formatTemplateLabel(cluster.label, t)
		: buildClusterHeading(cluster).heading;
}
