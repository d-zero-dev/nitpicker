import type { PaginationMode } from '../types.js';

import { useCallback, useSyncExternalStore } from 'react';

/** localStorage key for the persisted pagination mode. */
const STORAGE_KEY = 'nitpicker-pagination-mode';

/** Default mode when nothing is persisted yet (MPA per the design contract). */
const DEFAULT_MODE: PaginationMode = 'mpa';

/** Subscribers re-rendered whenever the module-level mode changes. */
const listeners = new Set<() => void>();

/**
 * Module-level singleton so every {@link usePaginationMode} call across the
 * app sees the same current value. Initialised lazily on first read.
 */
let cachedMode: PaginationMode | null = null;

/**
 * Resolves the initial mode from localStorage, falling back to the default.
 * Unknown stored values (forward-incompatible / hand-edited) are ignored.
 *
 * Wrapped in try/catch because some browser environments (private-browsing,
 * locked-down enterprise profiles, third-party iframe contexts) throw
 * `SecurityError` on plain `localStorage.getItem` access. The setter is
 * already guarded; the reader has to be too — otherwise the very first
 * `useSyncExternalStore` snapshot throws and the viewer white-screens.
 * @returns The initial pagination mode.
 */
function readInitialMode(): PaginationMode {
	try {
		const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
		if (saved === 'mpa' || saved === 'virtual') {
			return saved;
		}
	} catch {
		// Storage blocked / SecurityError — fall back to default.
	}
	return DEFAULT_MODE;
}

/**
 * Returns the current mode, initialising the module cache on first call.
 * @returns The current pagination mode.
 */
function getSnapshot(): PaginationMode {
	if (cachedMode === null) {
		cachedMode = readInitialMode();
	}
	return cachedMode;
}

/**
 * Subscribes to mode changes; called by {@link useSyncExternalStore}. Also
 * forwards cross-tab `storage` events so a change in another tab updates this
 * tab's components.
 * @param callback - The re-render trigger React passes in.
 * @returns An unsubscribe function.
 */
function subscribe(callback: () => void): () => void {
	listeners.add(callback);
	const storageHandler = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) {
			return;
		}
		cachedMode = null; // force re-read on next snapshot
		callback();
	};
	globalThis.addEventListener?.('storage', storageHandler);
	return () => {
		listeners.delete(callback);
		globalThis.removeEventListener?.('storage', storageHandler);
	};
}

/** The shape returned by {@link usePaginationMode}. */
export interface UsePaginationModeResult {
	/** The current mode. */
	mode: PaginationMode;
	/** Sets the mode and persists it to localStorage. */
	setMode: (next: PaginationMode) => void;
	/** Flips between `'mpa'` and `'virtual'`. */
	toggleMode: () => void;
}

/**
 * Reads and writes the user's pagination-mode preference.
 *
 * Backed by a module-level singleton broadcast through React's
 * `useSyncExternalStore`, so a change from the {@link
 * import('../components/pagination-mode-toggle.js').PaginationModeToggle}
 * in the TopBar instantly re-renders every list view consumer in the same
 * tab. localStorage `storage` events propagate changes across tabs.
 *
 * The default is `'mpa'` (URL-driven per-page table); `'virtual'` is opt-in.
 * @returns The current mode plus mutators.
 */
export function usePaginationMode(): UsePaginationModeResult {
	const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const setMode = useCallback((next: PaginationMode) => {
		cachedMode = next;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, next);
		} catch {
			// Ignore persistence failures (e.g. private browsing quota errors).
		}
		for (const listener of listeners) {
			listener();
		}
	}, []);
	const toggleMode = useCallback(() => {
		setMode(getSnapshot() === 'mpa' ? 'virtual' : 'mpa');
	}, [setMode]);
	return { mode, setMode, toggleMode };
}
