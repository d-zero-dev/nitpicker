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
 * - **In the main thread**: {@link ./worker/run-in-worker.ts!runInWorker} creates its own
 *   UrlEventBus and re-emits `'url'` messages received from the Worker.
 *
 * This indirection allows the same plugin code to work both in Worker threads
 * and in direct execution mode (when `useWorker` is `false`).
 * @see {@link ./worker/worker.ts} for Worker-side forwarding
 * @see {@link ./worker/run-in-worker.ts!runInWorker} for main-thread re-emission
 */
export class UrlEventBus extends EventEmitter<UrlEventBusEvent> {}
