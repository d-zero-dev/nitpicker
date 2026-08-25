import type { CreateSheet } from '../sheets/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { ResourceGroupStreamRow } from '@nitpicker/query';

import {
	getResourceReferrerUrlsByResourceIds,
	streamAllResourcesRaw,
	streamResourceGroups,
} from '@nitpicker/query';

import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { joinUrlsForNote } from '../utils/join-urls-for-note.js';
import { truncateNoteText } from '../utils/truncate-note-text.js';

/**
 * Options for the {@link createResources} factory.
 */
export interface CreateResourcesOptions {
	/**
	 * Collapse raw resource rows that share the same canonical URL
	 * (query *values* stripped, query *keys* sorted) into one row per
	 * `(canonical URL, status, contentType)` combination. Adds a `Count`
	 * column showing how many raw resources each row collapses.
	 *
	 * Path-embedded identifiers (e.g. tracking IDs in
	 * `/pagead/viewthroughconversion/<id>/`) are preserved, so the
	 * aggregated rows still expose every tracker present in the archive.
	 *
	 * Defaults to `false` (raw mode — one row per raw resource URL). The
	 * CLI's `report`/`pipeline` commands default their own
	 * `--dedupe-resources` flag to `true` and always pass an explicit
	 * value here.
	 */
	readonly dedupe?: boolean;
}

const RAW_HEADERS = [
	'URL',
	'Status Code',
	'Status Text',
	'Content Type',
	'Content Length',
	'Referrers',
] as const;

const DEDUPE_HEADERS = [
	'URL',
	'Status Code',
	'Status Text',
	'Content Type',
	'Content Length',
	'Referrers',
	'Count',
	'Query Pattern',
] as const;

/**
 * Formats the Content Length cell value. Returns a single number when
 * every raw resource in the group reported the same size, a `min-max`
 * string when the size varies, or `null` when nothing was recorded.
 * @param group - The resource group to format.
 */
export function formatContentLength(
	group: Pick<ResourceGroupStreamRow, 'contentLengthMin' | 'contentLengthMax'>,
): number | string | null {
	if (group.contentLengthMin == null) {
		return null;
	}
	if (group.contentLengthMin === group.contentLengthMax) {
		return group.contentLengthMin;
	}
	return `${group.contentLengthMin}-${group.contentLengthMax}`;
}

/**
 * Builds the cell row representation of a precomputed resource group.
 * @param group - The resource group to serialize.
 */
function resourceGroupToRow(group: ResourceGroupStreamRow) {
	return [
		createCellData({ value: group.canonicalUrl }, defaultCellFormat),
		createCellData({ value: group.status }, defaultCellFormat),
		createCellData({ value: group.statusText }, defaultCellFormat),
		createCellData({ value: group.contentType }, defaultCellFormat),
		createCellData({ value: formatContentLength(group) }, defaultCellFormat),
		createCellData(
			{
				value: `${group.referrerCount} pages`,
				note: truncateNoteText(group.referrerNote ?? ''),
			},
			defaultCellFormat,
		),
		createCellData({ value: group.count }, defaultCellFormat),
		createCellData({ value: group.queryPattern }, defaultCellFormat),
	];
}

/**
 * Counts every `resource_items` row, for raw mode's `estimateRowCount()`.
 * @param accessor - The archive accessor to query.
 */
async function countResources(accessor: ArchiveAccessor): Promise<number> {
	const knex = accessor.getKnex();
	const [row] = await knex('resource_items').count<{ count: string | number }[]>({
		count: '*',
	});
	return Number(row?.count ?? 0);
}

/**
 * Counts every `viewer_resource_groups` row, for dedupe mode's `estimateRowCount()`.
 * @param accessor - The archive accessor to query.
 */
async function countResourceGroups(accessor: ArchiveAccessor): Promise<number> {
	const knex = accessor.getKnex();
	const [row] = await knex('viewer_resource_groups').count<{ count: string | number }[]>({
		count: '*',
	});
	return Number(row?.count ?? 0);
}

/**
 * Creates the "Resources" sheet configuration factory.
 *
 * Lists all network resources (CSS, JS, images, fonts, tracking pixels,
 * etc.) discovered during crawling. Two modes are supported:
 *
 * - **Raw mode** (`{ dedupe: false }`, the default when `options` is
 *   omitted): one row per raw resource URL. Six columns: URL, Status Code,
 *   Status Text, Content Type, Content Length, Referrers. Streams
 *   `streamAllResourcesRaw` (write-model, `requiresReadModel` unset) and
 *   sends a row per chunk item immediately.
 * - **Dedupe mode** (`{ dedupe: true }`): collapses rows that share the
 *   same canonical URL (query values stripped, keys sorted) into one row
 *   per `(canonical URL, status, contentType)`. Adds a trailing `Count`
 *   column showing how many raw resources each row collapses. Useful when
 *   third-party tracking pixels generate millions of per-request unique
 *   URLs that would otherwise exceed the Google Sheets 10M-cell document
 *   limit.
 *
 * Dedupe mode's aggregation itself does not run here: it's precomputed
 * once, at `viewer-build` time, into `viewer_resource_groups` (see
 * `compute-resource-group-rows.ts`). This sheet only streams the
 * already-grouped, already-sorted rows via `streamResourceGroups`, so
 * `requiresReadModel: true`.
 * @param options - Optional configuration. See {@link CreateResourcesOptions}.
 */
export function createResources(options?: CreateResourcesOptions): CreateSheet {
	const dedupe = options?.dedupe === true;

	return (_reports, accessor) => {
		if (!dedupe) {
			return {
				name: 'Resources',
				createHeaders: () => [...RAW_HEADERS],
				estimateRowCount: () => countResources(accessor),
				async run({ sheet, maxRows, estimatedTotal, onProgress }) {
					let sent = 0;
					const total = estimatedTotal;
					for await (const chunk of streamAllResourcesRaw(accessor)) {
						const referrerUrlsByResourceId = await getResourceReferrerUrlsByResourceIds(
							accessor,
							chunk.map((row) => row.resourceId),
						);
						for (const row of chunk) {
							if (sent >= maxRows) {
								await sheet.flush();
								return;
							}
							const referrerUrls = referrerUrlsByResourceId.get(row.resourceId) ?? [];
							await sheet.appendRow([
								createCellData({ value: row.url }, defaultCellFormat),
								createCellData({ value: row.status }, defaultCellFormat),
								createCellData({ value: row.statusText }, defaultCellFormat),
								createCellData({ value: row.contentType }, defaultCellFormat),
								createCellData({ value: row.contentLength }, defaultCellFormat),
								createCellData(
									{
										value: `${referrerUrls.length} pages`,
										note: joinUrlsForNote(referrerUrls),
									},
									defaultCellFormat,
								),
							]);
							sent++;
							onProgress(sent, total);
						}
					}
					await sheet.flush();
				},
			};
		}

		return {
			name: 'Resources',
			requiresReadModel: true,
			createHeaders: () => [...DEDUPE_HEADERS],
			estimateRowCount: () => countResourceGroups(accessor),
			async run({ sheet, maxRows, estimatedTotal, onProgress }) {
				let sent = 0;
				const total = estimatedTotal;
				for await (const chunk of streamResourceGroups(accessor)) {
					for (const group of chunk) {
						if (sent >= maxRows) {
							await sheet.flush();
							return;
						}
						await sheet.appendRow(resourceGroupToRow(group));
						sent++;
						onProgress(sent, total);
					}
				}
				await sheet.flush();
			},
		};
	};
}
