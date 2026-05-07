import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';

/**
 * Event map for {@link UrlEventBus}.
 *
 * Currently supports a single event type for URL discovery notifications.
 */
export interface UrlEventBusEvent {
	/**
	 * Emitted when a URL is discovered or being processed.
	 * The payload is the URL href string.
	 */
	url: string;
}

/**
 * Typed event bus for URL discovery notifications.
 *
 * Used as a communication channel between Worker threads and the main thread:
 *
 * - **Inside Workers**: The each-page worker emits `'url'` events on a local
 *   UrlEventBus. The Worker thread entry point ({@link ./worker/worker.ts})
 *   listens for these and forwards them to the main thread via `parentPort.postMessage`.
 *
 * - **In the main thread**: {@link ./worker/worker-pool.ts!WorkerPool} routes
 *   `'url'` messages received from workers to the per-task UrlEventBus
 *   supplied by the caller.
 *
 * This indirection lets plugin code work the same way regardless of which
 * worker in the pool is currently processing a given page.
 * @see {@link ./worker/worker.ts} for worker-side forwarding
 * @see {@link ./worker/worker-pool.ts!WorkerPool} for main-thread routing
 */
export class UrlEventBus extends EventEmitter<UrlEventBusEvent> {}
