import type { PageMainContents } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Retrieves the full main-content drill-down for the page at the given URL:
 * the detected main element's identity, scalar word/scroll-height metrics,
 * and all nine `page_main_content_*` child tables (headings/images/tables/
 * buttons/iframes/videos/audios/canvases/customElements), in DOM order.
 *
 * Returns `null` when the page was never fully rendered (external, non-HTML,
 * or metadata-only scrape) — `page_meta.main_content_word_count` being `null`
 * is the signal, matching `computeMainContentsDenormalized`'s null-in-null-out
 * contract on the write side. A page that WAS rendered but had no detectable
 * main region still returns a full object (`main: null`, `wordCount: 0`,
 * empty arrays) rather than `null`.
 * @param accessor - The archive accessor to query.
 * @param url - The page URL.
 * @returns The main-content drill-down, or `null` when unavailable.
 * @example
 * const mc = await getPageMainContents(accessor, 'https://example.com/');
 * if (mc) {
 *   console.log(mc.wordCount, mc.headings.length, mc.main?.selector);
 * }
 */
export async function getPageMainContents(
	accessor: ArchiveAccessor,
	url: string,
): Promise<PageMainContents | null> {
	const knex = accessor.getKnex();
	const [page] = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
		.select(
			'ci.id as id',
			'pm.main_content_node_name as nodeName',
			'pm.main_content_id as elementId',
			'pm.main_content_role as role',
			'pm.main_content_selector as selector',
			'pm.main_content_class_list as classList',
			'pm.main_content_word_count as wordCount',
			'pm.main_content_body_word_count as bodyWordCount',
			'pm.scroll_height_desktop as scrollHeightDesktop',
			'pm.scroll_height_mobile as scrollHeightMobile',
		)
		.where('ur.url', url)
		.limit(1);
	if (!page || page.wordCount === null) {
		return null;
	}

	const [
		headings,
		images,
		tables,
		buttons,
		iframes,
		videos,
		audios,
		canvases,
		customElements,
	] = await Promise.all([
		accessor.getHeadingsOfPage(page.id),
		accessor.getMainContentImagesOfPage(page.id),
		accessor.getMainContentTablesOfPage(page.id),
		accessor.getButtonsOfPage(page.id),
		accessor.getIframesOfPage(page.id),
		accessor.getVideosOfPage(page.id),
		accessor.getAudiosOfPage(page.id),
		accessor.getCanvasesOfPage(page.id),
		accessor.getCustomElementsOfPage(page.id),
	]);

	return {
		main:
			page.nodeName === null
				? null
				: {
						nodeName: page.nodeName as string,
						id: page.elementId as string | null,
						role: page.role as string | null,
						selector: page.selector as string,
						classList:
							page.classList === null ? [] : (JSON.parse(page.classList) as string[]),
					},
		wordCount: page.wordCount as number,
		bodyWordCount: page.bodyWordCount as number,
		scrollHeight: {
			desktop: page.scrollHeightDesktop as number | null,
			mobile: page.scrollHeightMobile as number | null,
		},
		headings: headings.map((h) => ({ text: h.text, level: h.level })),
		images: images.map((i) => ({ src: i.src, alt: i.alt })),
		tables: tables.map((t) => ({
			rows: t.rows,
			cols: t.cols,
			hasHeader: !!t.hasHeader,
			hasFooter: !!t.hasFooter,
			hasMergedCell: !!t.hasMergedCell,
		})),
		buttons: buttons.map((b) => ({
			nodeName: b.nodeName,
			role: b.role,
			type: b.type,
			text: b.text,
			disabled: !!b.disabled,
		})),
		iframes: iframes.map((i) => ({
			src: i.src,
			title: i.title,
			width: i.width,
			height: i.height,
		})),
		videos: videos.map((v) => ({
			src: v.src,
			poster: v.poster,
			width: v.width,
			height: v.height,
		})),
		audios: audios.map((a) => ({ src: a.src })),
		canvases: canvases.map((c) => ({ width: c.width, height: c.height })),
		customElements: customElements.map((c) => ({
			nodeName: c.nodeName,
			elementId: c.elementId,
			classList: c.classList === null ? [] : (JSON.parse(c.classList) as string[]),
		})),
	};
}
