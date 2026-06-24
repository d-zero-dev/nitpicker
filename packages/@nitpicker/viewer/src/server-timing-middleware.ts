import type { MiddlewareHandler } from 'hono';

/**
 * Hono middleware that adds a `Server-Timing: total;dur=NNN` header to every
 * `/api/*` response so the operator can see backend wall-clock time per
 * request directly in DevTools → Network → Timing → Server Timing — without
 * adding noisy server-side console logs or needing a separate profiler.
 *
 * This is the diagnostic tool we reach for when a viewer interaction (e.g.
 * "Pager Next takes 10 s") needs to be triaged between backend (this number)
 * and frontend (the rest of the round-trip). If `total;dur=15` shows up in
 * the response but the user still sees a 10 s lag, the backend is innocent
 * and the work is somewhere in React render / DOM / network.
 *
 * Uses `performance.now()` (millisecond resolution, monotonic) for parity
 * with what the browser's Performance panel reports.
 * @returns The middleware handler.
 */
export function serverTimingMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		const start = performance.now();
		await next();
		const dur = (performance.now() - start).toFixed(1);
		c.res.headers.set('Server-Timing', `total;dur=${dur}`);
	};
}
