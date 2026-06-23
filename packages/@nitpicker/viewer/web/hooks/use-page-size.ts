import type { PageSize } from '../types.js';

import { useCallback, useSyncExternalStore } from 'react';

import { parsePageSize } from './parse-page-size.js';

/** localStorage key for the persisted page size. */
const STORAGE_KEY = 'nitpicker-page-size';

/**
 * Default page size when nothing is persisted yet. Matches the legacy
 * `PAGE_SIZE` constant so existing virtual-scroll behaviour is preserved by
 * default.
 */
const DEFAULT_PAGE_SIZE: PageSize = 100;

/** Allowed page-size values in the MPA pager's `<select>`. */
export const PAGE_SIZE_OPTIONS: readonly PageSize[] = [50, 100, 200];

/** Subscribers re-rendered whenever the module-level page size changes. */
const listeners = new Set<() => void>();

/** Module-level singleton so every consumer sees the same value. */
let cachedSize: PageSize | null = null;

/**
 * Resolves the initial page size from localStorage, falling back to the
 * default. Hand-edited / unsupported values are ignored.
 *
 * Wrapped in try/catch because some browser environments (private-browsing,
 * locked-down enterprise profiles, third-party iframe contexts) throw
 * `SecurityError` on plain `localStorage.getItem`. The setter is already
 * guarded; the reader has to be too — otherwise the very first
 * `useSyncExternalStore` snapshot throws and the viewer white-screens.
 * @returns The initial page size.
 */
function readInitialSize(): PageSize {
	try {
		const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
		if (saved === null || saved === undefined) {
			return DEFAULT_PAGE_SIZE;
		}
		return parsePageSize(Number(saved)) ?? DEFAULT_PAGE_SIZE;
	} catch {
		// Storage blocked / SecurityError — fall back to default.
		return DEFAULT_PAGE_SIZE;
	}
}

/**
 * Returns the current size, initialising the module cache on first call.
 * @returns The current page size.
 */
function getSnapshot(): PageSize {
	if (cachedSize === null) {
		cachedSize = readInitialSize();
	}
	return cachedSize;
}

/**
 * Subscribes to size changes; also re-reads on cross-tab `storage` events.
 * @param callback - The re-render trigger React passes in.
 * @returns An unsubscribe function.
 */
function subscribe(callback: () => void): () => void {
	listeners.add(callback);
	const storageHandler = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) {
			return;
		}
		cachedSize = null;
		callback();
	};
	globalThis.addEventListener?.('storage', storageHandler);
	return () => {
		listeners.delete(callback);
		globalThis.removeEventListener?.('storage', storageHandler);
	};
}

/** The shape returned by {@link usePageSize}. */
export interface UsePageSizeResult {
	/** The current page size. */
	pageSize: PageSize;
	/** Sets the page size; ignored if the value is not a recognised option. */
	setPageSize: (next: PageSize) => void;
}

/**
 * Reads and writes the user's MPA page-size preference.
 *
 * Persists to localStorage and broadcasts to every consumer in the tab via
 * `useSyncExternalStore`. Only used by MPA mode; virtual mode keeps using
 * the fixed `PAGE_SIZE` constant (its per-fetch granularity is invisible to
 * the user).
 *
 * The page size is intentionally kept out of the URL — leaving it in
 * localStorage keeps share URLs short and means a colleague opening a
 * `?page=N` link sees the same logical position even with their own page-size
 * preference.
 * @returns The current page size plus a setter.
 */
export function usePageSize(): UsePageSizeResult {
	const pageSize = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const setPageSize = useCallback((next: PageSize) => {
		const validated = parsePageSize(next);
		if (validated === null) {
			return;
		}
		cachedSize = validated;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, String(validated));
		} catch {
			// Ignore persistence failures.
		}
		for (const listener of listeners) {
			listener();
		}
	}, []);
	return { pageSize, setPageSize };
}
