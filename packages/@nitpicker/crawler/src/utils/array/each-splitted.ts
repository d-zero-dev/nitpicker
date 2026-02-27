import { splitArray } from '@d-zero/shared/split-array';

/**
 * Splits an array into chunks of the specified size and executes a callback
 * on each chunk in parallel using `Promise.all`.
 * @template T - The element type of the array.
 * @param a - The array to split into chunks.
 * @param count - The maximum number of elements per chunk.
 * @param callback - A function to invoke on each chunk. May be synchronous or asynchronous.
 * @returns A promise that resolves when all chunk callbacks have completed.
 */
export async function eachSplitted<T>(
	a: T[],
	count: number,
	callback: (items: T[]) => void | Promise<void>,
) {
	const splitted = splitArray(a, count);
	await Promise.all(splitted.map((items) => callback(items)));
}
