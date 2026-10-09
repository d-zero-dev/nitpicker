import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Copies `resource_items` (and its `technology_js_scan_cache` companion)
 * for every `full`/`replace`-action row in `temp.xfer_ri_plan`
 * ({@link import('./plan-resource-items.js').planResourceItems}), then
 * backfills each `full` row's `dest_id`.
 *
 * `is_external` is carried over from the source verbatim here — it is
 * NOT authoritative yet. `resource_items.is_external` is a pure scope
 * check (unlike `content_items.is_external`, "was this taken on as a
 * target"), so
 * {@link import('./reclassify-resource-externality.js').reclassifyResourceExternality}
 * always recomputes it against the OUTPUT archive's own (merged or
 * narrowed) scope once every source has been copied — writing the
 * source's value here is only a placeholder that step immediately
 * overwrites.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after the dictionary copies
 *   (`temp.xfer_map_url_refs`/`xfer_map_blob_refs`/`xfer_map_content_type_refs`/
 *   `xfer_map_header_sets` populated) and after
 *   {@link import('./plan-resource-items.js').planResourceItems}.
 * @example
 * ```ts
 * await planResourceItems(trx, 'concat');
 * await copyDictionariesForConcat(trx);
 * await copyResourceItems(trx);
 * ```
 */
export async function copyResourceItems(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT INTO main.resource_items
			(url_id, url_blob_id, is_external, status, status_text, content_type_id, content_length, header_set_id, compress, cdn, source)
		SELECT
			mu.dest_id, mb.dest_id, s.is_external, s.status, s.status_text,
			mct.dest_id, s.content_length, mhs.dest_id, s.compress, s.cdn, s.source
		FROM ${SRC}.resource_items s
		JOIN xfer_ri_plan rp ON rp.src_id = s.id AND rp.action = ${TRANSFER_ACTION.full}
		LEFT JOIN xfer_map_url_refs mu ON mu.src_id = s.url_id
		LEFT JOIN xfer_map_blob_refs mb ON mb.src_id = s.url_blob_id
		LEFT JOIN xfer_map_content_type_refs mct ON mct.src_id = s.content_type_id
		LEFT JOIN xfer_map_header_sets mhs ON mhs.src_id = s.header_set_id
	`);

	await trx.raw(`
		UPDATE xfer_ri_plan
		SET dest_id = x.dest_id
		FROM (
			SELECT rp.src_id AS src_id, d.id AS dest_id
			FROM xfer_ri_plan rp
			JOIN ${SRC}.resource_items s ON s.id = rp.src_id
			LEFT JOIN xfer_map_url_refs mu ON mu.src_id = s.url_id
			LEFT JOIN xfer_map_blob_refs mb ON mb.src_id = s.url_blob_id
			JOIN main.resource_items d ON d.url_id = mu.dest_id OR d.url_blob_id = mb.dest_id
			WHERE rp.action = ${TRANSFER_ACTION.full}
		) x
		WHERE xfer_ri_plan.src_id = x.src_id
	`);

	await trx.raw(`
		UPDATE main.resource_items
		SET
			status = x.status, status_text = x.status_text, content_type_id = x.content_type_id,
			content_length = x.content_length, header_set_id = x.header_set_id,
			compress = x.compress, cdn = x.cdn, source = x.source, is_external = x.is_external
		FROM (
			SELECT
				rp.dest_id AS dest_id, s.status, s.status_text, mct.dest_id AS content_type_id,
				s.content_length, mhs.dest_id AS header_set_id, s.compress, s.cdn, s.source, s.is_external
			FROM xfer_ri_plan rp
			JOIN ${SRC}.resource_items s ON s.id = rp.src_id
			LEFT JOIN xfer_map_content_type_refs mct ON mct.src_id = s.content_type_id
			LEFT JOIN xfer_map_header_sets mhs ON mhs.src_id = s.header_set_id
			WHERE rp.action = ${TRANSFER_ACTION.replace}
		) x
		WHERE main.resource_items.id = x.dest_id
	`);

	await trx.raw(`
		INSERT INTO main.technology_js_scan_cache (resourceId, scannedAt, technology, evidence)
		SELECT rp.dest_id, c.scannedAt, c.technology, c.evidence
		FROM ${SRC}.technology_js_scan_cache c
		JOIN xfer_ri_plan rp ON rp.src_id = c.resourceId
			AND rp.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
		WHERE true
		ON CONFLICT(resourceId) DO UPDATE SET
			scannedAt = excluded.scannedAt,
			technology = excluded.technology,
			evidence = excluded.evidence
	`);
}
