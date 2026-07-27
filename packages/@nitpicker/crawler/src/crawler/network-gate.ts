/**
 * Level-triggered gate that dealer worker callbacks await before doing any
 * network work. Achieves "pause the crawl until the network recovers"
 * without touching `@d-zero/dealer` internals — a closed gate just makes
 * the worker's task body a long-running `await`, which is all dealer ever
 * sees.
 *
 * **`epoch`** counts outage generations: it increments on every `close()`
 * transition (open → closed) and holds that value for the remainder of the
 * closed period AND through the following open period, until the next
 * `close()`. This is the hook `destinationCache` / `dnsBurnedHostCache`
 * eviction uses: an entry written while the gate was closed is tagged with
 * `gate.epoch` at write time; after `open()`, the caller purges entries
 * tagged with that same epoch value. Because `epoch` only advances on
 * `close()` (never on `open()`), entries written during ordinary (open)
 * operation are never mistakenly tagged with a soon-to-be-purged epoch —
 * only writes that happen while `isOpen` is `false` get tagged at all.
 */
export default class NetworkGate {
	#epoch = 0;
	#open = true;

	#waiters: (() => void)[] = [];

	/** `true` when the gate is open (the default). */
	get isOpen(): boolean {
		return this.#open;
	}

	/**
	 * Current outage-generation counter. See the class docstring for how
	 * cache-eviction callers are expected to use this value.
	 */
	get epoch(): number {
		return this.#epoch;
	}

	/**
	 * Close the gate, blocking future {@link wait} callers until the next
	 * {@link open}. Idempotent — calling `close()` while already closed does
	 * nothing (in particular, it does NOT bump {@link epoch} a second time,
	 * which would otherwise let a still-open outage's cache entries escape
	 * eviction under a stale epoch number).
	 */
	close(): void {
		if (!this.#open) {
			return;
		}
		this.#open = false;
		this.#epoch += 1;
	}
	/**
	 * Open the gate, resolving every {@link wait} caller currently pending —
	 * including ones that subscribed after `close()` but before this call.
	 * Idempotent — calling `open()` while already open does nothing.
	 */
	open(): void {
		if (this.#open) {
			return;
		}
		this.#open = true;
		const waiters = this.#waiters;
		this.#waiters = [];
		for (const resolve of waiters) {
			resolve();
		}
	}
	/**
	 * Resolve immediately if the gate is open; otherwise resolve on the next
	 * {@link open}. Multiple concurrent callers all resolve on the same
	 * `open()` call — no awaiter is dropped regardless of when it subscribed
	 * relative to others.
	 */
	wait(): Promise<void> {
		if (this.#open) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.#waiters.push(resolve);
		});
	}
}
