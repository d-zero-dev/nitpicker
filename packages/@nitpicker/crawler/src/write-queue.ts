/**
 * A lightweight serial write queue that ensures asynchronous operations
 * execute one at a time in FIFO order.
 *
 * Used to serialize concurrent Archive writes from crawler event handlers,
 * preventing SQLite write-lock contention under high parallelism.
 */
export class WriteQueue {
	/** The tail of the promise chain used for serialization. */
	#chain: Promise<void> = Promise.resolve();

	/** The number of operations currently waiting or executing in the queue. */
	#pending = 0;

	/**
	 * The number of operations currently waiting or executing in the queue.
	 * @returns The current pending operation count.
	 */
	get pending() {
		return this.#pending;
	}

	/**
	 * Returns a promise that resolves when all currently enqueued operations
	 * have completed.
	 * @returns A promise that resolves when the queue is drained.
	 */
	async drain(): Promise<void> {
		await this.#chain;
	}

	/**
	 * Enqueues an asynchronous operation to run after all previously enqueued
	 * operations have completed. Operations are guaranteed to execute serially
	 * in the order they were enqueued.
	 * @template T The resolved type of the operation's promise.
	 * @param operation - The async function to execute.
	 * @returns A promise that resolves with the operation's result, or rejects
	 *          if the operation throws.
	 */
	enqueue<T>(operation: () => Promise<T>): Promise<T> {
		this.#pending++;
		return new Promise<T>((resolve, reject) => {
			this.#chain = this.#chain.then(async () => {
				try {
					const result = await operation();
					resolve(result);
				} catch (error) {
					reject(error);
				} finally {
					this.#pending--;
				}
			});
		});
	}
}
