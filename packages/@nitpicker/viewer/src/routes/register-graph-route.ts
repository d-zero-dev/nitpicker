import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getCachedLinkGraph } from '../graph-cache.js';
import { toNumber } from '../query-params/to-number.js';

/**
 * Default cap on graph nodes returned by `/api/graph` when no `limit` is
 * supplied. Two ceilings make this necessary:
 *
 * 1. **V8 string limit** (~512 MB). On a 10 GB-class archive the
 *    unlimited graph has ~175 k internal HTML pages and several million
 *    distinct anchor edges; serialising that to JSON exceeds V8's
 *    maximum string length and `c.json` aborts with `RangeError:
 *    Invalid string length` — the client sees `{"error":"Invalid string
 *    length"}` after waiting ~1 min for the SQL to finish.
 * 2. **Visual usability**. Force-directed layouts (sigma.js + graphology
 *    forceAtlas2 in the viewer) get denser past a few thousand nodes,
 *    but 50k still renders in a few seconds and shows the full
 *    inventory-* subgraph on typical audit archives (which is the
 *    entire point of the source-based node coloring — a 1000-node cap
 *    truncates every inventory node out because they have inDegree ≈ 0).
 *
 * Callers can override by passing `?limit=` explicitly — `limit=0` is
 * interpreted as "no cap" and accepts the V8 risk knowingly.
 */
const DEFAULT_GRAPH_NODE_LIMIT = 50_000;

/**
 * Registers `GET /api/graph?limit=` — the internal-page link graph (nodes +
 * edges). When `limit` is omitted, defaults to {@link DEFAULT_GRAPH_NODE_LIMIT}
 * so a large archive never OOMs the JSON serializer; pass `limit=0` to
 * opt out of the cap.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerGraphRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/graph', async (c) => {
		const raw = toNumber(c.req.query('limit'));
		const limit =
			raw === undefined ? DEFAULT_GRAPH_NODE_LIMIT : raw === 0 ? undefined : raw;
		return c.json(await getCachedLinkGraph(context, limit));
	});
}
