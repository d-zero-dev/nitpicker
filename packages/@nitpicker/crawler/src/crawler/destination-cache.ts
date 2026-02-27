import type { PageData } from '@d-zero/beholder';

/**
 * In-memory cache of HEAD request results keyed by URL (without hash).
 * Stores either the successful {@link PageData} or the {@link Error} to avoid
 * repeated requests to the same destination.
 */
export const destinationCache = new Map<string, PageData | Error>();
