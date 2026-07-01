/**
 * Row shape of the `viewer_read_model_meta` singleton table (always exactly
 * one row, `id = 1`). Shared between `hasViewerReadModel` and
 * `getViewerReadModelVersion`, which both probe this table.
 */
export interface ViewerReadModelMetaRow {
	/** Always `1` — enforced by a `CHECK (id = 1)` constraint. */
	id: 1;
	/**
	 * The read-model schema/build version that produced this row. Compared
	 * against `VIEWER_READ_MODEL_SCHEMA_VERSION` by `ensureViewerReadModel`
	 * to decide whether a rebuild is needed.
	 */
	schema_version: number;
	/** Unix epoch milliseconds when this build completed. */
	built_at: number;
	/** Number of rows written to `viewer_pages` during this build. */
	source_row_count: number;
}
