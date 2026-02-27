import type { CreateSheet, createCellTextFormat } from '../sheets/types.js';
import type { Referrer } from '@nitpicker/crawler';

import { decodeURISafely } from '@d-zero/shared/decode-uri-safely';

import { pLog, reportLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { booleanFormatError } from '../sheets/format.js';
import { nonNullFilter } from '../utils/non-null-filter.js';

const log = pLog.extend('PageList');

const indexTitles = new Map<string, string>();

const indexRefs = new Map<
	string,
	{
		basename: string | null;
		referrers: Referrer[];
	}[]
>();

/**
 * Creates the "Page List" sheet configuration -- the primary sitemap-style report.
 *
 * This is the most complex sheet, combining crawler metadata with analyze
 * plugin data into a comprehensive per-page inventory:
 *
 * - **URL decomposition**: Protocol, domain, and up to 10 path segments
 *   for hierarchical filtering in the spreadsheet.
 * - **Title shortening**: Directory index titles are subtracted from child
 *   page titles to produce concise display titles (e.g. removing the site
 *   name suffix). The `indexTitles` map accumulates these across pages.
 * - **Link quality**: Internal/external link counts with bad-link breakdowns
 *   (status >= 400, excluding 401 which is often auth-protected).
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
 * @param reports
 */
export const createPageList: CreateSheet = (reports) => {
	const reportPageData = reports
		.map((r) => (r.pageData ? { name: r.name, pageData: r.pageData } : null))
		.filter(nonNullFilter);

	let maxDepth = 0;

	return {
		name: 'Page List',
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
				'canonical',
				'alternate',
				'twitter:card',
				'og:site_name',
				'og:url',
				'og:title',
				'og:description',
				'og:type',
				'og:image',
			];

			for (const report of reports) {
				if (report.pageData) {
					headers.push(...Object.values(report.pageData.headers));
				}
			}

			return headers;
		},
		async eachPage(page) {
			if (!page.isInternalPage() || !page.isTarget) {
				return;
			}

			const url = page.url;

			maxDepth = Math.max(url.depth, maxDepth);

			const paths = [...url.paths];
			paths[paths.length - 1] = `${paths.at(-1)}${url.query ? `?${url.query}` : ''}`;
			const [path1, path2, path3, path4, path5, path6, path7, path8, path9, path10] =
				paths.map((p) => `/${decodeURISafely(p)}`);

			const anchors = await page.getAnchors();
			let iLinks = 0;
			const iBadLinks: string[] = [];
			let xLinks = 0;
			const xBadLinks: string[] = [];
			for (const anchor of anchors) {
				if (anchor.isExternal) {
					xLinks += 1;
					if (!anchor.status || (anchor.status >= 400 && anchor.status !== 401)) {
						const url =
							anchor.href === anchor.url ? anchor.url : `${anchor.href} => ${anchor.url}`;
						xBadLinks.push(
							`${anchor.textContent} (${anchor.status} ${anchor.statusText} ${url})`,
						);
					}
				} else {
					iLinks += 1;
					if (!anchor.status || (anchor.status >= 400 && anchor.status !== 401)) {
						const url =
							anchor.href === anchor.url ? anchor.url : `${anchor.href} => ${anchor.url}`;
						iBadLinks.push(
							`${anchor.textContent} (${anchor.status} ${anchor.statusText} ${url})`,
						);
					}
				}
			}

			const refers = await page.getReferrers();

			let title = page.title;
			const dirname = url.dirname || '/';
			const parentDir = `/${url.paths.slice(0, -2).join('/')}`;

			const dirTitle = url.isIndex
				? indexTitles.get(parentDir) || indexTitles.get(dirname)
				: indexTitles.get(dirname) || indexTitles.get(parentDir);

			if (dirTitle && title.includes(dirTitle)) {
				title = title.replace(dirTitle, '').replaceAll(/\||｜/g, '').trim();
				if (!title) {
					title = page.title;
				}
			}

			const parentRefs = indexRefs.get(dirname);

			if (url.isIndex) {
				indexTitles.set(dirname, page.title);

				if (parentRefs) {
					parentRefs.push({
						basename: url.basename,
						referrers: refers,
					});
					// return;
				} else {
					indexRefs.set(dirname, [
						{
							basename: url.basename,
							referrers: refers,
						},
					]);
				}
			}

			const isRoot = url.dirname == null;
			const depth = isRoot ? 0 : url.depth - (url.isIndex ? 1 : 0);

			const data = [
				createCellData(
					{
						value: title,
						cellFormat: { padding: { left: Math.max(depth, 0) * 20 + 3 } },
						note: `Full-title:\n${page.title}`,
					},
					defaultCellFormat,
				),
				createCellData({ value: page.title }, defaultCellFormat),
				createCellData(
					{
						value: page.url.href,
						textFormat: { link: { uri: page.url.href } },
					},
					defaultCellFormat,
				),
				createCellData({ value: url.protocol }, defaultCellFormat),
				createCellData({ value: url.hostname }, defaultCellFormat),
				createCellData({ value: path1 || null }, defaultCellFormat),
				createCellData({ value: path2 || null }, defaultCellFormat),
				createCellData({ value: path3 || null }, defaultCellFormat),
				createCellData({ value: path4 || null }, defaultCellFormat),
				createCellData({ value: path5 || null }, defaultCellFormat),
				createCellData({ value: path6 || null }, defaultCellFormat),
				createCellData({ value: path7 || null }, defaultCellFormat),
				createCellData({ value: path8 || null }, defaultCellFormat),
				createCellData({ value: path9 || null }, defaultCellFormat),
				createCellData({ value: path10 || null }, defaultCellFormat),
				createCellData({ value: page.status || -1 }, defaultCellFormat),
				createCellData(
					{
						value: page.redirectFrom.length,
						note: page.redirectFrom.map((r) => r.url).join('\n'),
					},
					defaultCellFormat,
				),
				createCellData({ value: page.lang || 'N/A' }, defaultCellFormat),
				createCellData({ value: iLinks }, defaultCellFormat),
				createCellData(
					{ value: iBadLinks.length, note: iBadLinks.join('\n') },
					defaultCellFormat,
				),
				createCellData({ value: xLinks }, defaultCellFormat),
				createCellData(
					{ value: xBadLinks.length, note: xBadLinks.join('\n') },
					defaultCellFormat,
				),
				createCellData(
					() => ({
						value:
							url.isIndex && parentRefs
								? parentRefs.reduce((prev, ref) => prev + ref.referrers.length, 0)
								: refers.length,
						note:
							url.isIndex && parentRefs
								? parentRefs
										.map(
											(ref) =>
												`[[/${ref.basename || ''}]]\n${ref.referrers
													.map((ref) => ref.url)
													.join('\n')}`,
										)
										.join('\n\n')
								: refers.map((ref) => ref.url).join('\n'),
					}),
					defaultCellFormat,
				),
				createCellData({ value: page.description }, defaultCellFormat),
				createCellData({ value: page.keywords }, defaultCellFormat),
				createCellData({ value: !!page.noindex }, defaultCellFormat),
				createCellData({ value: !!page.nofollow }, defaultCellFormat),
				createCellData({ value: !!page.noarchive }, defaultCellFormat),
				createCellData({ value: page.canonical }, defaultCellFormat),
				createCellData({ value: page.alternate }, defaultCellFormat),
				createCellData({ value: page.twitter_card }, defaultCellFormat),
				createCellData({ value: page.og_site_name }, defaultCellFormat),
				createCellData(
					{
						value: page.og_url,
						textFormat: { link: { uri: page.og_url } },
					},
					defaultCellFormat,
				),
				createCellData({ value: page.og_title }, defaultCellFormat),
				createCellData({ value: page.og_description }, defaultCellFormat),
				createCellData({ value: page.og_type }, defaultCellFormat),
				createCellData({ value: page.og_image }, defaultCellFormat),
			];

			for (const report of reportPageData) {
				const tableData = report.pageData.data[page.url.href];
				const options = report.pageData.options
					? report.pageData.options[page.url.href]
					: null;

				if (!tableData) {
					reportLog("%s did'nt have table of %s", report.name, page.url);
					continue;
				}

				reportLog('Add %s to table from %s', page.url.href, report.name);
				data.push(
					...Object.keys(report.pageData.headers).map((key) => {
						const option = options ? options[key] || null : null;
						const data = tableData[key];

						const format: createCellTextFormat = {};
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
							if (option.color != null) {
								// format.foregroundColor = option.color;
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

							note = data?.note || `${option.note || ''}`;
						}

						const value = data?.value;

						return createCellData(
							{ value, textFormat: format, note, ifNull: false },
							defaultCellFormat,
						);
					}),
				);
			}

			return [data];
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
