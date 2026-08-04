/**
 * Current schema/build version of the viewer read model. Bump this whenever
 * the table shapes or population logic in `viewer-read-model/` change in a
 * way that requires existing archives to rebuild.
 *
 * `ensureViewerReadModel` compares this constant against the persisted
 * `viewer_read_model_meta.schema_version` to decide whether a rebuild is
 * needed.
 */
export const VIEWER_READ_MODEL_SCHEMA_VERSION = 23;
