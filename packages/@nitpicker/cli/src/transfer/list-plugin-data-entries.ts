import fs from 'node:fs/promises';

/**
 * Top-level entries every source tmpDir has for reasons OTHER than analyze
 * plugin namespace data — never reported as "dropped plugin data".
 */
const KNOWN_NON_PLUGIN_ENTRIES = new Set([
	'db.sqlite',
	'db.sqlite-wal',
	'db.sqlite-shm',
	'inventory',
	'.nitpicker-cache-ready',
	'error.log',
]);

/**
 * Lists a source archive's top-level tmpDir entries that `concat`/`split`
 * do NOT carry over — analyze plugin namespace output
 * (`ArchiveAccessor#setData`'s `analysis/<plugin-name>/*` directories,
 * and any other top-level file a plugin might have written), so the CLI
 * can name what was left behind and point the operator at re-running
 * `nitpicker analyze` on the output.
 *
 * `inventory/` (copied separately by
 * `copyInventorySourceLists`), the SQLite files, the tar-cache ready
 * marker, and `error.log` are all excluded — none of them are plugin
 * data, and reporting them as "dropped" would be misleading noise.
 * @param sourceTmpDir - The source's extracted tmpDir (`accessor.tmpDir`).
 * @returns Entry names (files or directories) considered plugin data, or
 *   `[]` if the tmpDir has none.
 * @example
 * ```ts
 * const dropped = await listPluginDataEntries(accessor.tmpDir);
 * // ['analysis'] — the analyze-plugin namespace root, if any plugin ran
 * ```
 */
export async function listPluginDataEntries(sourceTmpDir: string): Promise<string[]> {
	const entries = await fs.readdir(sourceTmpDir);
	return entries.filter((entry) => !KNOWN_NON_PLUGIN_ENTRIES.has(entry));
}
