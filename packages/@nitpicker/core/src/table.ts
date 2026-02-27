import type {
	TableData,
	TableHeaderMap,
	TableHeaders,
	TablePages,
	TableRow,
} from './types.js';
import type { ExURL as URL } from '@d-zero/shared/parse-url';

/**
 * In-memory accumulator for tabular report data.
 *
 * Table collects column headers from plugins and per-URL row data from
 * analysis results. It uses `Map` internally for efficient merge operations
 * (multiple plugins contribute columns to the same URL row), then serializes
 * to plain objects for JSON storage in the archive.
 *
 * ## Merge semantics
 *
 * When data is added for a URL that already has entries, the new columns are
 * shallow-merged with existing ones (later values overwrite earlier ones for
 * the same key). This allows multiple plugins to contribute different columns
 * to the same row without conflicts, as long as they use distinct column keys.
 * @template T - String literal union of all column keys across plugins.
 * @example
 * ```ts
 * const table = new Table<'title' | 'score'>();
 * table.addHeaders({ title: 'Page Title', score: 'Score' });
 * table.addDataToUrl(url, {
 *   title: { value: 'Home' },
 *   score: { value: 95 },
 * });
 * const json = table.toJSON();
 * // { headers: { title: 'Page Title', score: 'Score' }, data: { 'https://...': { ... } } }
 * ```
 * @see {@link ./types.ts} for the underlying type aliases
 */
export class Table<T extends string> {
	/** Per-URL row data. Key is the URL href string. */
	#data: TableRow<T> = new Map();

	/** Column header definitions accumulated from all plugins. */
	#headers: TableHeaderMap<T> = new Map();

	/**
	 * Merges a batch of URL-keyed page data into the table.
	 * Typically called with deserialized data from a Worker thread or cache.
	 * @param data - Object where keys are URL strings and values are column data.
	 */
	addData(data: TablePages<T>) {
		const entries = Object.entries(data);
		for (const [k, v] of entries) {
			this.#add(k, v);
		}
	}

	/**
	 * Adds or merges column data for a single URL.
	 * @param url - The page URL to associate the data with.
	 * @param data - Column values to store for this URL.
	 */
	addDataToUrl(url: URL, data: TableData<T>) {
		this.#add(url.href, data);
	}

	/**
	 * Registers column headers from a plugin.
	 *
	 * Multiple plugins can call this independently; headers are merged by key.
	 * If two plugins declare the same key with different labels, the later
	 * registration wins.
	 * @param headers - Map of column keys to display labels.
	 */
	addHeaders(headers: TableHeaders<T>) {
		const entries = Object.entries(headers);
		for (const entry of entries) {
			const [key, name] = entry as [T, string];
			this.#headers.set(key, name);
		}
	}

	/**
	 * Returns all row data as a plain object (serializable to JSON).
	 * @returns URL-keyed record of column data.
	 */
	getData(): TablePages<T> {
		return mapToObject(this.#data);
	}

	/**
	 * Retrieves column data for a specific URL, or `undefined` if not present.
	 * @param url - The page URL to look up.
	 * @returns Column data for the URL, or `undefined`.
	 */
	getDataByUrl(url: URL) {
		return this.#data.get(url.href);
	}

	/**
	 * Serializes the entire table (headers + data) to a JSON-compatible object.
	 *
	 * Used when storing the table in the archive via `archive.setData('analysis/table', ...)`.
	 * @returns Plain object with `headers` and `data` properties.
	 */
	toJSON() {
		return {
			headers: mapToObject(this.#headers),
			data: mapToObject(this.#data),
		};
	}

	/**
	 * Internal merge-or-insert for a single URL row.
	 * If the URL already has data, the new values are shallow-merged.
	 * @param k - URL href string used as the row key.
	 * @param v - Column data to add or merge.
	 */
	#add(k: string, v: TableData<T>) {
		const data = this.#data.get(k);
		if (data) {
			this.#data.set(k, {
				...data,
				...v,
			});
		} else {
			this.#data.set(k, v);
		}
	}
}

/**
 * Converts a `Map<K, V>` to a plain `Record<K, V>` object.
 *
 * Used internally to serialize Map-based storage into JSON-compatible
 * objects for archive storage and Worker message passing.
 * @template K - String key type.
 * @template V - Value type.
 * @param map - The Map to convert.
 * @returns A plain object with the same key-value pairs.
 */
function mapToObject<K extends string, V>(map: Map<K, V>) {
	const entries = map.entries();
	const object = {} as Record<K, V>;
	for (const entry of entries) {
		const [k, v] = entry;
		object[k] = v;
	}
	return object;
}
