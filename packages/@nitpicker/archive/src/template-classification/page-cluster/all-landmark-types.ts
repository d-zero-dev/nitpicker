import type { LandmarkType } from './types.js';

/**
 * Every landmark type, in the fixed order cluster reasons list them (and
 * the native Stage A builds each page's instance list in), so their output
 * is byte-stable. A type's index is also its code in the native output
 * (`StageAUnit.instanceTypes`, `landmark_code` in `nitpicker_napi`).
 */
export const ALL_LANDMARK_TYPES: readonly LandmarkType[] = [
	'header',
	'footer',
	'nav',
	'aside',
	'form',
	'search',
];
