import { describe, it, expect } from 'vitest';

import NetworkGate from './network-gate.js';

/** Flush one microtask turn so a `.then()` callback queued just before this call has had a chance to run. */
function flushMicrotasks(): Promise<void> {
	return Promise.resolve();
}

describe('NetworkGate', () => {
	describe('state transitions', () => {
		it('is open by default', () => {
			const gate = new NetworkGate();
			expect(gate.isOpen).toBe(true);
		});

		it('resolves wait() immediately while open', async () => {
			const gate = new NetworkGate();
			let resolved = false;
			void gate.wait().then(() => {
				resolved = true;
			});
			await flushMicrotasks();
			expect(resolved).toBe(true);
		});

		it('blocks wait() while closed, and resolves it once open() is called', async () => {
			const gate = new NetworkGate();
			gate.close();
			let resolved = false;
			void gate.wait().then(() => {
				resolved = true;
			});
			await flushMicrotasks();
			expect(resolved).toBe(false);

			gate.open();
			await flushMicrotasks();
			expect(resolved).toBe(true);
		});
	});

	describe('level-triggered wakeup', () => {
		it('wakes every pending waiter on a single open() call', async () => {
			const gate = new NetworkGate();
			gate.close();
			const flags = [false, false, false];
			void gate.wait().then(() => {
				flags[0] = true;
			});
			void gate.wait().then(() => {
				flags[1] = true;
			});
			void gate.wait().then(() => {
				flags[2] = true;
			});
			await flushMicrotasks();
			expect(flags).toEqual([false, false, false]);

			gate.open();
			await flushMicrotasks();
			expect(flags).toEqual([true, true, true]);
		});

		it('wakes a waiter that subscribed after close() but before open()', async () => {
			const gate = new NetworkGate();
			gate.close();
			await flushMicrotasks();

			let resolved = false;
			void gate.wait().then(() => {
				resolved = true;
			});

			gate.open();
			await flushMicrotasks();
			expect(resolved).toBe(true);
		});
	});

	describe('epoch', () => {
		it('starts at 0', () => {
			const gate = new NetworkGate();
			expect(gate.epoch).toBe(0);
		});

		it('increments on close() and holds its value through the following open()', () => {
			const gate = new NetworkGate();
			gate.close();
			expect(gate.epoch).toBe(1);
			gate.open();
			expect(gate.epoch).toBe(1);
		});

		it('increases monotonically across repeated close→open cycles', () => {
			const gate = new NetworkGate();
			gate.close();
			gate.open();
			gate.close();
			expect(gate.epoch).toBe(2);
			gate.open();
			gate.close();
			expect(gate.epoch).toBe(3);
		});

		it('does not bump epoch when open() is called while already open (idempotent)', () => {
			const gate = new NetworkGate();
			gate.close();
			gate.open();
			expect(gate.epoch).toBe(1);
			gate.open();
			expect(gate.epoch).toBe(1);
		});

		it('does not bump epoch when close() is called while already closed (idempotent)', () => {
			// A stale second `close()` bumping the epoch would let cache
			// entries written just before it escape eviction under the wrong
			// generation number.
			const gate = new NetworkGate();
			gate.close();
			expect(gate.epoch).toBe(1);
			gate.close();
			expect(gate.epoch).toBe(1);
		});
	});
});
