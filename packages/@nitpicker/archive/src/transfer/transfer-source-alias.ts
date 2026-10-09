/**
 * The fixed schema alias a source archive's `db.sqlite` is `ATTACH`ed under
 * during a transfer. A constant (not a per-call parameter) because every
 * transfer SQL statement in `archive/transfer/` hard-codes this name —
 * allowing a caller-supplied alias would mean threading it through every
 * one of those statements for no real benefit (a transfer only ever
 * attaches one source at a time; see `transfer-archive-rows.ts`).
 */
export const TRANSFER_SOURCE_ALIAS = 'xfer_src';
