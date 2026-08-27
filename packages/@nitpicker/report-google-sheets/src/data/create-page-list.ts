import type { CreateSheet } from '../sheets/types.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import {
	buildRedirectFromUrlsByDestId,
	countViewerPagesTotal,
	getOutboundLinkFactsByPageIds,
	streamPageListRows,
} from '@nitpicker/query';

import { pLog, reportLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { booleanFormatError } from '../sheets/format.js';
import { joinUrlsForNote } from '../utils/join-urls-for-note.js';
import { nonNullFilter } from '../utils/non-null-filter.js';
import { truncateNoteText } from '../utils/truncate-note-text.js';

const log = pLog.extend('PageList');

/**
 * Creates the "Page List" sheet configuration -- the primary sitemap-style report.
 *
 * This is the most complex sheet, combining crawler metadata with analyze
 * plugin data into a comprehensive per-page inventory:
 *
 * - **URL decomposition**: Protocol, domain, and up to 10 path segments for
 *   hierarchical filtering in the spreadsheet — computed once at read-model
 *   build time, not per-batch (see `PageListItem.path1`'s docs).
 * - **Title shortening**: Directory index titles are subtracted from child
 *   page titles to produce concise display titles (e.g. removing the site
 *   name suffix) — computed once at read-model build time, not per-batch
 *   (see `PageListItem.displayTitle`'s docs).
 * - **Link quality**: Internal/external link counts with bad-link breakdowns
 *   (status >= 400, excluding 401 which is often auth-protected) — fetched
 *   per cursor batch via `getOutboundLinkFactsByPageIds`.
 * - **SEO metadata**: description, keywords, canonical, alternate, OGP, etc.
 * - **Plugin columns**: Dynamic columns from analyze plugin `pageData`.
 *
 * Conditional formatting highlights:
 * - Bad links (non-zero count)
 * - Missing language attribute
 * - Low internal referrer count (orphan pages)
 * - Suspicious path names (copy, dummy, underscore prefixed)
 * - HTTP protocol (non-HTTPS)
 * - Error-like titles and non-success status codes
 *
 * Unused path columns (beyond the deepest URL) are hidden automatically.
 *
 * ## Streaming design (report OOM fix)
 *
 * Reads `streamPageListRows` (a `viewer_pages` keyset sweep,
 * `requiresReadModel: true` — see that function's docs for why it exists
 * instead of reusing the viewer UI's `listViewerPages`) one chunk at a time
 * and sends each row via `sheet.appendRow(...)` immediately — no lazy
 * (`createCellData(() => ...)`) cells anywhere in this file. The pre-rewrite
 * version used a lazy thunk for "Internal Referrers" (its value depended on
 * sibling index pages processed later in the same batch), which disabled
 * `@d-zero/google-sheets`' automatic 2500-row flush for the entire batch —
 * the direct cause of the OOM this rewrite fixes. That cross-page dependency
 * no longer exists: `displayTitle`/`inboundLinkCount`/
 * `dirIndexInboundLinkCount`/`protocol`/`hostname`/`path1`..`path10` are all
 * precomputed once, for every page, before the read model is queryable at
 * all (see `build-viewer-read-model.ts`), so every column is known
 * synchronously from the current row alone.
 * @param reports - Analyze plugin reports to extract per-page data columns from
 * @param accessor - The archive accessor to query.
 */
export const createPageList: CreateSheet = (reports, accessor) => {
	let maxDepth = 0;

	const reportPageData = reports
		.map((r) => (r.pageData ? { name: r.name, pageData: r.pageData } : null))
		.filter(nonNullFilter);

	return {
		name: 'Page List',
		requiresReadModel: true,
		createHeaders() {
			const headers = [
				'Title',
				'Full Title',
				'URL',
				'Protocol',
				'Domain',
				'path1',
				'path2',
				'path3',
				'path4',
				'path5',
				'path6',
				'path7',
				'path8',
				'path9',
				'path10',
				'Status Code',
				'Redirect From',
				'Language',
				'charset',
				'Internal Links',
				'Internal Bad Links',
				'External Links',
				'External Bad Links',
				'Internal Referrers',
				'description',
				'keywords',
				'noindex',
				'nofollow',
				'noarchive',
				'robots:raw',
				'canonical',
				'manifest',
				'theme-color',
				'twitter:card',
				'twitter:site',
				'twitter:creator',
				'og:site_name',
				'og:url',
				'og:title',
				'og:description',
				'og:type',
				'og:image',
				'og:image:alt',
				'og:locale',
				'og:article:published_time',
				'jsonld_count',
				'tags_providers',
				'main_content_selector',
				'main_content_word_count',
				'main_content_body_word_count',
				'main_content_heading_count',
				'main_content_image_count',
				'main_content_table_count',
				'main_content_button_count',
				'main_content_iframe_count',
				'main_content_video_count',
				'main_content_audio_count',
				'main_content_canvas_count',
				'main_content_custom_element_count',
				'scroll_height_desktop',
				'scroll_height_mobile',
			];

			for (const report of reports) {
				if (report.pageData) {
					headers.push(...Object.values(report.pageData.headers));
				}
			}

			return headers;
		},
		estimateRowCount() {
			return countViewerPagesTotal(accessor.getKnex(), { isExternal: false });
		},
		async run({ sheet, maxRows, estimatedTotal, onProgress }) {
			const redirectFromByDestId = await buildRedirectFromUrlsByDestId(accessor);

			let sent = 0;
			const total = estimatedTotal;
			for await (const chunk of streamPageListRows(accessor)) {
				const linkFactsByPageId = await getOutboundLinkFactsByPageIds(
					accessor,
					chunk.map((item) => item.pageId),
				);

				for (const item of chunk) {
					if (sent >= maxRows) {
						await sheet.flush();
						return;
					}
					// Only for the Title column's indentation depth below --
					// protocol/hostname/path1..10 come precomputed from the read
					// model (item.*) and no longer need a per-row parse.
					const parsedForDepth = parseUrl(item.url);
					if (!parsedForDepth) {
						continue;
					}
					maxDepth = Math.max(parsedForDepth.depth, maxDepth);
					const isRoot = parsedForDepth.dirname == null;
					const depth = isRoot
						? 0
						: parsedForDepth.depth - (parsedForDepth.isIndex ? 1 : 0);

					const facts = linkFactsByPageId.get(item.pageId);
					const redirectFromUrls = redirectFromByDestId.get(item.pageId) ?? [];

					const internalReferrers =
						item.dirIndexInboundLinkCount ?? item.inboundLinkCount ?? 0;

					const data = [
						createCellData(
							{
								value: item.displayTitle ?? item.title,
								cellFormat: { padding: { left: Math.max(depth, 0) * 20 + 3 } },
								note: truncateNoteText(`Full-title:\n${item.title}`),
							},
							defaultCellFormat,
						),
						createCellData({ value: item.title }, defaultCellFormat),
						createCellData(
							{ value: item.url, textFormat: { link: { uri: item.url } } },
							defaultCellFormat,
						),
						createCellData({ value: item.protocol }, defaultCellFormat),
						createCellData({ value: item.hostname }, defaultCellFormat),
						createCellData({ value: item.path1 }, defaultCellFormat),
						createCellData({ value: item.path2 }, defaultCellFormat),
						createCellData({ value: item.path3 }, defaultCellFormat),
						createCellData({ value: item.path4 }, defaultCellFormat),
						createCellData({ value: item.path5 }, defaultCellFormat),
						createCellData({ value: item.path6 }, defaultCellFormat),
						createCellData({ value: item.path7 }, defaultCellFormat),
						createCellData({ value: item.path8 }, defaultCellFormat),
						createCellData({ value: item.path9 }, defaultCellFormat),
						createCellData({ value: item.path10 }, defaultCellFormat),
						createCellData({ value: item.status ?? -1 }, defaultCellFormat),
						createCellData(
							{
								value: redirectFromUrls.length,
								note: joinUrlsForNote(redirectFromUrls),
							},
							defaultCellFormat,
						),
						createCellData({ value: item.lang || 'N/A' }, defaultCellFormat),
						createCellData({ value: item.charset }, defaultCellFormat),
						createCellData({ value: facts?.internalLinks ?? 0 }, defaultCellFormat),
						createCellData({ value: facts?.internalBadLinks ?? 0 }, defaultCellFormat),
						createCellData({ value: facts?.externalLinks ?? 0 }, defaultCellFormat),
						createCellData({ value: facts?.externalBadLinks ?? 0 }, defaultCellFormat),
						createCellData({ value: internalReferrers }, defaultCellFormat),
						createCellData({ value: item.description }, defaultCellFormat),
						createCellData({ value: item.keywords }, defaultCellFormat),
						createCellData({ value: item.noindex }, defaultCellFormat),
						createCellData({ value: item.nofollow }, defaultCellFormat),
						createCellData({ value: item.noarchive }, defaultCellFormat),
						createCellData({ value: item.robotsRaw }, defaultCellFormat),
						createCellData({ value: item.canonical }, defaultCellFormat),
						createCellData({ value: item.manifest }, defaultCellFormat),
						createCellData({ value: item.themeColor }, defaultCellFormat),
						createCellData({ value: item.twitterCard }, defaultCellFormat),
						createCellData({ value: item.twitterSite }, defaultCellFormat),
						createCellData({ value: item.twitterCreator }, defaultCellFormat),
						createCellData({ value: item.ogSiteName }, defaultCellFormat),
						createCellData(
							{ value: item.ogUrl, textFormat: { link: { uri: item.ogUrl ?? '' } } },
							defaultCellFormat,
						),
						createCellData({ value: item.ogTitle }, defaultCellFormat),
						createCellData({ value: item.ogDescription }, defaultCellFormat),
						createCellData({ value: item.ogType }, defaultCellFormat),
						createCellData({ value: item.ogImage }, defaultCellFormat),
						createCellData({ value: item.ogImageAlt }, defaultCellFormat),
						createCellData({ value: item.ogLocale }, defaultCellFormat),
						createCellData({ value: item.ogArticlePublishedTime }, defaultCellFormat),
						// Denormalised aggregates: written at scrape time so no per-page
						// GROUP BY is needed here. `tagsProvidersCsv` is comma-separated
						// for native Google Sheets list rendering.
						createCellData({ value: item.jsonldCount }, defaultCellFormat),
						createCellData({ value: item.tagsProvidersCsv }, defaultCellFormat),
						// beholder MainContentsData / ScrollHeightData denormalised
						// aggregates. `null` (page never fully rendered) or `0` (rendered,
						// no main region / no elements of that kind found) render as
						// blank / 0 respectively — no special-casing needed here.
						createCellData({ value: item.mainContentSelector }, defaultCellFormat),
						createCellData({ value: item.mainContentWordCount }, defaultCellFormat),
						createCellData({ value: item.mainContentBodyWordCount }, defaultCellFormat),
						createCellData({ value: item.mainContentHeadingCount }, defaultCellFormat),
						createCellData({ value: item.mainContentImageCount }, defaultCellFormat),
						createCellData({ value: item.mainContentTableCount }, defaultCellFormat),
						createCellData({ value: item.mainContentButtonCount }, defaultCellFormat),
						createCellData({ value: item.mainContentIframeCount }, defaultCellFormat),
						createCellData({ value: item.mainContentVideoCount }, defaultCellFormat),
						createCellData({ value: item.mainContentAudioCount }, defaultCellFormat),
						createCellData({ value: item.mainContentCanvasCount }, defaultCellFormat),
						createCellData(
							{ value: item.mainContentCustomElementCount },
							defaultCellFormat,
						),
						createCellData({ value: item.scrollHeightDesktop }, defaultCellFormat),
						createCellData({ value: item.scrollHeightMobile }, defaultCellFormat),
					];

					for (const report of reportPageData) {
						const tableData = report.pageData.data[item.url];
						const options = report.pageData.options
							? report.pageData.options[item.url]
							: null;

						if (!tableData) {
							reportLog("%s did'nt have table of %s", report.name, item.url);
							continue;
						}

						reportLog('Add %s to table from %s', item.url, report.name);
						data.push(
							...Object.keys(report.pageData.headers).map((key) => {
								const option = options ? options[key] || null : null;
								const cellData = tableData[key];

								const format: Record<string, unknown> = {};
								let note: string | undefined;

								if (option) {
									if (option.bold) {
										format.bold = !!option.bold;
									}
									if (option.fontFamily != null) {
										format.fontFamily = `${option.fontFamily}`;
									}
									if (option.fontSize != null) {
										format.fontSize = +option.fontSize;
									}
									if (option.italic != null) {
										format.italic = !!option.italic;
									}
									if (option.strike != null) {
										format.strikethrough = !!option.strike;
									}
									if (option.underline != null) {
										format.underline = !!option.underline;
									}

									note = truncateNoteText(cellData?.note || `${option.note || ''}`);
								}

								const value = cellData?.value;

								return createCellData(
									{ value, textFormat: format, note, ifNull: false },
									defaultCellFormat,
								);
							}),
						);
					}

					await sheet.appendRow(data);
					sent++;
					onProgress(sent, total);
				}
			}
			await sheet.flush();
		},
		async updateSheet(sheet) {
			await sheet.frozen(1, 1);

			await sheet.conditionalFormat(
				[
					sheet.getColNumByHeaderName('Internal Bad Links'),
					sheet.getColNumByHeaderName('External Bad Links'),
				],
				{
					booleanRule: {
						condition: {
							type: 'NUMBER_NOT_EQ',
							values: [
								{
									userEnteredValue: '0',
								},
							],
						},
						format: booleanFormatError,
					},
				},
			);

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Language')], {
				booleanRule: {
					condition: {
						type: 'TEXT_EQ',
						values: [
							{
								userEnteredValue: 'N/A',
							},
						],
					},
					format: booleanFormatError,
				},
			});

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Internal Referrers')], {
				booleanRule: {
					condition: {
						type: 'NUMBER_LESS',
						values: [
							{
								userEnteredValue: '2',
							},
						],
					},
					format: booleanFormatError,
				},
			});

			await sheet.conditionalFormat(
				[
					sheet.getColNumByHeaderName('path1'),
					sheet.getColNumByHeaderName('path2'),
					sheet.getColNumByHeaderName('path3'),
					sheet.getColNumByHeaderName('path4'),
					sheet.getColNumByHeaderName('path5'),
					sheet.getColNumByHeaderName('path6'),
					sheet.getColNumByHeaderName('path7'),
					sheet.getColNumByHeaderName('path8'),
					sheet.getColNumByHeaderName('path9'),
					sheet.getColNumByHeaderName('path10'),
				],
				{
					booleanRule: {
						condition: {
							type: 'CUSTOM_FORMULA',
							values: [
								{
									userEnteredValue:
										'=REGEXMATCH(INDIRECT(ADDRESS(ROW(),COLUMN())), "(?i)(^/_|_$|_copy|-copy|copy_|copy-|dummy)")',
								},
							],
						},
						format: booleanFormatError,
					},
				},
			);

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Title')], {
				booleanRule: {
					condition: {
						type: 'CUSTOM_FORMULA',
						values: [
							{
								userEnteredValue:
									'=REGEXMATCH(INDIRECT(ADDRESS(ROW(),COLUMN())), "(?i)(^| )(401|403|404|500|501|502|503)")',
							},
						],
					},
					format: booleanFormatError,
				},
			});

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Protocol')], {
				booleanRule: {
					condition: {
						type: 'TEXT_EQ',
						values: [
							{
								userEnteredValue: 'http:',
							},
						],
					},
					format: booleanFormatError,
				},
			});

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Status Code')], {
				booleanRule: {
					condition: {
						type: 'NUMBER_NOT_BETWEEN',
						values: [
							{
								userEnteredValue: '200',
							},
							{
								userEnteredValue: '399',
							},
						],
					},
					format: booleanFormatError,
				},
			});

			for (let i = maxDepth + 1; i <= 10; i++) {
				const name = `path${i}`;
				log('Hide col %s', name);
				await sheet.hideCol(sheet.getColNumByHeaderName(name));
			}
		},
	};
};
