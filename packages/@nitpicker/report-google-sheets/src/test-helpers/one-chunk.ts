/**
 * Wraps a fixed chunk array as the single yield of an async generator, for
 * mocking a chunked `stream*` read function from `@nitpicker/query`
 * (e.g. `streamAllContentItems`, `streamAnchorFactEdges`).
 * @param chunk - The one chunk to yield.
 * @yields The given chunk, once.
 */
export async function* oneChunk<T>(chunk: T[]): AsyncGenerator<T[]> {
	await Promise.resolve();
	yield chunk;
}
