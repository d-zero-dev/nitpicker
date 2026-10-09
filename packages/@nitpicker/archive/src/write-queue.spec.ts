import { describe, it, expect } from 'vitest';

import { WriteQueue } from './write-queue.js';

describe('WriteQueue', () => {
	it('executes operations serially in FIFO order', async () => {
		const queue = new WriteQueue();
		const order: number[] = [];

		// Enqueue operations that resolve at different speeds
		const p1 = queue.enqueue(async () => {
			await delay(30);
			order.push(1);
		});
		const p2 = queue.enqueue(async () => {
			await delay(10);
			order.push(2);
		});
		const p3 = queue.enqueue(() => {
			order.push(3);
			return Promise.resolve();
		});

		await Promise.all([p1, p2, p3]);

		// Despite different delays, execution order must be FIFO
		expect(order).toEqual([1, 2, 3]);
	});

	it('returns the value from the operation', async () => {
		const queue = new WriteQueue();
		const result = await queue.enqueue(() => Promise.resolve(42));
		expect(result).toBe(42);
	});

	it('propagates errors from operations', async () => {
		const queue = new WriteQueue();
		const error = new Error('test error');

		await expect(queue.enqueue(() => Promise.reject(error))).rejects.toThrow(
			'test error',
		);
	});

	it('continues processing after an error', async () => {
		const queue = new WriteQueue();

		// First operation fails
		const p1 = queue.enqueue(() => Promise.reject(new Error('fail')));

		// Second operation should still execute
		const p2 = queue.enqueue(() => Promise.resolve('ok'));

		await expect(p1).rejects.toThrow('fail');
		await expect(p2).resolves.toBe('ok');
	});

	it('tracks pending count correctly', async () => {
		const queue = new WriteQueue();
		expect(queue.pending).toBe(0);

		let resolveFirst!: () => void;
		const blocker = new Promise<void>((r) => {
			resolveFirst = r;
		});

		const p1 = queue.enqueue(() => blocker);
		const p2 = queue.enqueue(() => Promise.resolve());

		// p1 is executing, p2 is waiting
		expect(queue.pending).toBe(2);

		resolveFirst();
		await Promise.all([p1, p2]);

		expect(queue.pending).toBe(0);
	});

	it('drain() waits for all enqueued operations', async () => {
		const queue = new WriteQueue();
		const order: string[] = [];

		void queue.enqueue(async () => {
			await delay(20);
			order.push('a');
		});
		void queue.enqueue(() => {
			order.push('b');
			return Promise.resolve();
		});

		await queue.drain();

		expect(order).toEqual(['a', 'b']);
		expect(queue.pending).toBe(0);
	});

	it('accepts enqueue after drain() completes', async () => {
		const queue = new WriteQueue();
		const order: string[] = [];

		void queue.enqueue(async () => {
			await delay(10);
			order.push('before-drain');
		});

		await queue.drain();
		expect(order).toEqual(['before-drain']);

		// Enqueue after drain should still work
		const result = await queue.enqueue(() => {
			order.push('after-drain');
			return Promise.resolve('done');
		});

		expect(result).toBe('done');
		expect(order).toEqual(['before-drain', 'after-drain']);
		expect(queue.pending).toBe(0);
	});

	it('catches synchronous throw inside operation', async () => {
		const queue = new WriteQueue();

		await expect(
			queue.enqueue(() => {
				throw new Error('sync throw');
			}),
		).rejects.toThrow('sync throw');

		// Queue should remain functional after sync throw
		const result = await queue.enqueue(() => Promise.resolve('recovered'));
		expect(result).toBe('recovered');
	});

	it('drain() resolves immediately on an empty queue', async () => {
		const queue = new WriteQueue();
		expect(queue.pending).toBe(0);
		await queue.drain();
		expect(queue.pending).toBe(0);
	});

	it('handles high concurrency without interleaving', async () => {
		const queue = new WriteQueue();
		let active = 0;
		let maxActive = 0;

		const tasks = Array.from({ length: 50 }, (_, i) =>
			queue.enqueue(async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await delay(1);
				active--;
				return i;
			}),
		);

		const results = await Promise.all(tasks);

		// Confirm only one operation ran at a time
		expect(maxActive).toBe(1);
		// Confirm all results returned in order
		expect(results).toEqual(Array.from({ length: 50 }, (_, i) => i));
	});
});

/**
 * Helper to create a delay promise.
 * @param ms - milliseconds to wait
 */
function delay(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
