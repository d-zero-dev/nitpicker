import type { ClusterLandmarkType } from '../types.js';

/**
 * Stable display order of landmark types, matching the order
 * `summarizeTemplateClusterReason` emits `reason.landmarks` in.
 */
export const LANDMARK_TYPE_ORDER: readonly ClusterLandmarkType[] = [
	'header',
	'footer',
	'nav',
	'aside',
	'form',
	'search',
];
