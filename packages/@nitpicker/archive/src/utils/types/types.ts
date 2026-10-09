/**
 * Scrape-result shapes the archive layer persists.
 *
 * Structurally equivalent mirrors of `@d-zero/beholder`'s exported types
 * (`PageData`, `Resource`, `MainContentsData`, `ConsoleLogEntry`, …) so
 * that `@nitpicker/archive` — and every read-only consumer that depends on
 * it (query / viewer / mcp-server / report-*) — does not pull in beholder,
 * puppeteer or dealer. The crawler passes beholder's values straight
 * through: TypeScript's structural typing accepts them without conversion.
 * Structural typing alone would NOT catch a field beholder adds, so
 * `@nitpicker/crawler`'s `beholder-type-mirror-parity.ts` asserts at build
 * time that every mirror here is identical to the installed beholder's —
 * update this file in the same change that bumps `@d-zero/beholder`.
 *
 * The only intentional widening is `ConsoleLogEntry.type` (puppeteer's
 * `ConsoleMessageType` union becomes `string`), because naming the union
 * would require a `puppeteer` dependency. `Meta` and its sub-types live in
 * `../../meta/types.ts`.
 * @module
 */
import type { Meta } from '../../meta/types.js';
import type { CDNType } from '@d-zero/shared/detect-cdn';
import type { CompressType } from '@d-zero/shared/detect-compress';
import type { ExURL } from '@d-zero/shared/parse-url';

/**
 * Numeric outcome code for one device preset's `<img>` scan, mirroring
 * `@d-zero/beholder`'s `ImageScanCode` (`IMAGE_SCAN_CODE`: 0=ok /
 * 1=degraded / 2=nav-unsettled / 3=frame-lost / 4=scroll-height-exceeded /
 * 255=unknown).
 */
export type ImageScanCode = 0 | 1 | 2 | 3 | 4 | 255;

/**
 * Scraped page data returned by the scraper after successfully processing a page.
 */
export interface PageData {
	/** The parsed URL of the page. */
	url: ExURL;

	/** Chain of redirect URLs traversed to reach the final destination. */
	redirectPaths: string[];

	/** Whether this page is a target page (internal and within the crawl scope). */
	isTarget: boolean;

	/** Whether this page is external to the crawl scope. */
	isExternal: boolean;

	/** HTTP status code of the response. */
	status: number;

	/** HTTP status text of the response. */
	statusText: string;

	/** The Content-Type header value, or `null` if unavailable. */
	contentType: string | null;

	/** The Content-Length header value in bytes, or `null` if unavailable. */
	contentLength: number | null;

	/** Raw HTTP response headers, or `null` if unavailable. */
	responseHeaders: Record<string, string | string[] | undefined> | null;

	/** Extracted metadata from the page (title, description, OGP, etc.). */
	meta: Meta;

	/** List of anchor elements found on the page. */
	anchorList: AnchorData[];

	/** List of image elements found on the page. */
	imageList: ImageElement[];

	/** HTML snapshot of the rendered DOM. */
	html: string;

	/**
	 * Quantitative main-content metrics extracted in the browser after load.
	 * `null` when the page is non-HTML, external, non-HTTP, or otherwise not fully scraped.
	 * When HTML is scraped but no main region is found, this is still an object with empty arrays and `wordCount: 0`.
	 */
	mainContents: MainContentsData | null;

	/**
	 * `document.body.scrollHeight` at desktop-compact and mobile-small viewports.
	 * `null` when not measured (non-HTML, external, non-HTTP, or skipped).
	 */
	scrollHeight: ScrollHeightData | null;

	/**
	 * Per-device-preset outcome of the `<img>` element scan performed by
	 * `Scraper#fetchImages`, keyed the same way as {@link ScrollHeightData}.
	 * A field is `null` when that device preset's image scan was never
	 * attempted (non-HTML, external, non-HTTP page, or `captureImages: false`);
	 * otherwise it is an {@link ImageScanCode} recording why the scan
	 * succeeded, degraded, or was abandoned. See `@d-zero/beholder`'s `IMAGE_SCAN_CODE`.
	 * @example
	 * ```ts
	 * if (pageData.imageScan.mobile === IMAGE_SCAN_CODE.SCROLL_HEIGHT_EXCEEDED) {
	 *   // mobile images were skipped due to an oversized scrollHeight
	 * }
	 * ```
	 */
	imageScan: ImageScanData;

	/** Always `false` for successfully scraped pages. Skipped pages are never passed to the archive as `PageData`. */
	isSkipped: false;
}

/**
 * `document.body.scrollHeight` measured at the scraper's desktop and mobile device presets.
 */
export interface ScrollHeightData {
	/** Height at `desktop-compact` (width 1280), or `null` if that preset failed. */
	desktop: number | null;
	/** Height at `mobile-small` (width 320 @ 2x), or `null` if that preset failed. */
	mobile: number | null;
}

/**
 * Per-device-preset {@link ImageScanCode} outcome of `Scraper#fetchImages`,
 * mirroring {@link ScrollHeightData}'s desktop/mobile shape.
 */
export interface ImageScanData {
	/** Outcome for `desktop-compact` (width 1280), or `null` if not attempted. */
	desktop: ImageScanCode | null;
	/** Outcome for `mobile-small` (width 320 @ 2x), or `null` if not attempted. */
	mobile: ImageScanCode | null;
}

/**
 * Quantitative metrics for the detected main content region of a page.
 * @example
 * ```ts
 * const { mainContents } = pageData;
 * if (mainContents) {
 *   console.log(mainContents.wordCount, mainContents.headings.length);
 * }
 * ```
 */
export interface MainContentsData {
	/** `document.title` trimmed. Empty string when the title is empty. */
	title: string;
	/**
	 * Identifying info for the detected main region element.
	 * `null` when no selector matched (arrays are empty and `wordCount` is `0`).
	 */
	main: MainContentsMainTag | null;
	/**
	 * Character count of the main region's `textContent` after whitespace removal.
	 * `0` when no main region was found or the text is whitespace-only.
	 */
	wordCount: number;
	/**
	 * Character count of `document.body` `textContent` after whitespace removal.
	 * Measured even when no main region is found (`0` if `body` is missing).
	 */
	bodyWordCount: number;
	/** Headings (`h1`–`h6`) inside the main region, in DOM order. */
	headings: MainContentsHeading[];
	/** Images (`img`, `input[type=image]`) inside the main region, in DOM order. */
	images: MainContentsImage[];
	/** Tables inside the main region, in DOM order. */
	tables: MainContentsTable[];
	/** Button-like elements inside the main region, in DOM order. */
	buttons: MainContentsButton[];
	/** Iframes inside the main region, in DOM order. */
	iframes: MainContentsIframe[];
	/** Videos inside the main region, in DOM order. */
	videos: MainContentsVideo[];
	/** Audios inside the main region, in DOM order. */
	audios: MainContentsAudio[];
	/** Canvases inside the main region, in DOM order. */
	canvases: MainContentsCanvas[];
}

/**
 * Identifying information about the DOM element used as the main content area.
 */
export interface MainContentsMainTag {
	/** Element tag name (e.g. `"MAIN"`, `"DIV"`), as reported by `nodeName`. */
	nodeName: string;
	/** The element's `id`, or `null` when empty/absent. */
	id: string | null;
	/** CSS class names on the element. */
	classList: string[];
	/** The WAI-ARIA `role` attribute value, or `null` when absent. */
	role: string | null;
	/**
	 * A simple diagnostic CSS selector built from tag + id + classes
	 * (not `@medv/finder`). // cspell:disable-line
	 */
	selector: string;
}

/**
 * A heading element (`h1`–`h6`) found within the main content area.
 */
export interface MainContentsHeading {
	/** Heading text after whitespace removal, or `null` when empty. */
	text: string | null;
	/** Heading level from the tag name. */
	level: 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * An `<img>` or `<input type="image">` element found in the main content.
 */
export interface MainContentsImage {
	/** Resolved absolute `src` URL. */
	src: string;
	/** `alt` attribute value (may be an empty string). */
	alt: string;
}

/**
 * Structural summary of a `<table>` found within the main content.
 */
export interface MainContentsTable {
	/** Number of `<tr>` elements. */
	rows: number;
	/** Number of `th`/`td` cells in the first row, or `0` when there is no row. */
	cols: number;
	/** Whether the table contains a `<thead>`. */
	hasHeader: boolean;
	/** Whether the table contains a `<tfoot>`. */
	hasFooter: boolean;
	/** Whether any cell uses `colspan` or `rowspan`. */
	hasMergedCell: boolean;
}

/**
 * A button-like element found in the main content
 * (`button`, `[role=button]`, `[class*=button]`, `[class*=btn]`).
 */
export interface MainContentsButton {
	/** Element tag name (e.g. `"BUTTON"`, `"A"`, `"DIV"`). */
	nodeName: string;
	/** `role` attribute, or `null` when absent. */
	role: string | null;
	/** `type` for `<button>` / `<input>`, otherwise `null`. */
	type: string | null;
	/** Label text after whitespace removal, or `null` when empty. */
	text: string | null;
	/** `true` when `disabled` or `aria-disabled="true"`. */
	disabled: boolean;
}

/**
 * An `<iframe>` found in the main content.
 */
export interface MainContentsIframe {
	/** Resolved absolute `src` URL (empty string when unset). */
	src: string;
	/** `title` attribute, or `null` when the attribute is absent. */
	title: string | null;
	/** Raw `width` attribute string, or `null` when absent. */
	width: string | null;
	/** Raw `height` attribute string, or `null` when absent. */
	height: string | null;
}

/**
 * A `<video>` found in the main content.
 */
export interface MainContentsVideo {
	/**
	 * Resolved media URL: `currentSrc`, else `src` attribute, else first `source[src]`, else `""`.
	 */
	src: string;
	/** Resolved `poster` URL, or `null` when unset. */
	poster: string | null;
	/** IDL `width` in pixels. */
	width: number;
	/** IDL `height` in pixels. */
	height: number;
}

/**
 * An `<audio>` found in the main content.
 */
export interface MainContentsAudio {
	/**
	 * Resolved media URL: `currentSrc`, else `src` attribute, else first `source[src]`, else `""`.
	 */
	src: string;
}

/**
 * A `<canvas>` found in the main content.
 */
export interface MainContentsCanvas {
	/** IDL bitmap width. */
	width: number;
	/** IDL bitmap height. */
	height: number;
}

/**
 * Information about an image element found on a page.
 */
export interface ImageElement {
	/** The `src` attribute value of the image element. */
	src: string;

	/** The `currentSrc` property value (the actual URL loaded by the browser). */
	currentSrc: string;

	/** The `alt` attribute value of the image element. */
	alt: string;

	/** The CSS layout width of the image in pixels. */
	width: number;

	/** The CSS layout height of the image in pixels. */
	height: number;

	/** The intrinsic width of the image in pixels. */
	naturalWidth: number;

	/** The intrinsic height of the image in pixels. */
	naturalHeight: number;

	/** Whether the image uses lazy loading (`loading="lazy"` or IntersectionObserver). */
	isLazy: boolean;

	/** The viewport width at which this image was captured. */
	viewportWidth: number;

	/** The outer HTML source code of the image element. */
	sourceCode: string;
}

/**
 * A network resource (CSS, JS, image, etc.) captured during page scraping.
 */
export interface Resource {
	/** The URL of the resource. */
	url: ExURL;

	/** Whether the resource is from an external domain. */
	isExternal: boolean;

	/** Whether the resource request resulted in an error. */
	isError: boolean;

	/** HTTP status code, or `null` if the request failed. */
	status: number | null;

	/** HTTP status text, or `null` if the request failed. */
	statusText: string | null;

	/** The Content-Type header value, or `null` if unavailable. */
	contentType: string | null;

	/** The Content-Length header value in bytes, or `null` if unavailable. */
	contentLength: number | null;

	/** The compression algorithm used, or `false` if uncompressed. */
	compress: false | CompressType;

	/** The CDN provider detected from response headers, or `false` if none detected. */
	cdn: false | CDNType;

	/** Raw HTTP response headers, or `null` if unavailable. */
	headers: Record<string, string | string[] | undefined> | null;
}

/**
 * Data extracted from an anchor element (`<a>` or `<area>`) on a page.
 */
export interface AnchorData {
	/**
	 * Extracts the value of the `href` attribute from anchor element (`<a>` `<area>`)
	 */
	href: ExURL;

	/**
	 * The accessible name of the anchor element
	 */
	textContent: string;

	/**
	 * Whether the anchor points to an external URL.
	 * Set by `processAnchors()` in the crawler; not available in the sub-process.
	 */
	isExternal?: boolean;
}

/**
 * A single console message or uncaught page error captured during page scraping.
 * Captured via Puppeteer's `console` and `pageerror` page events; internal pages only.
 */
export interface ConsoleLogEntry {
	/** The URL (without hash) of the page that produced this message. */
	pageUrl: string;
	/**
	 * The console message type (Puppeteer's `ConsoleMessageType`, e.g. `"log"`, `"warn"`, `"error"`),
	 * or `"pageerror"` for an uncaught exception / unhandled Promise rejection.
	 * Widened to `string` so the archive does not depend on `puppeteer`.
	 */
	type: string;
	/** The message text, or the error's `message` for `"pageerror"` entries. */
	text: string;
	/**
	 * Arguments passed to the console call, resolved via `JSHandle.jsonValue()`.
	 * An individual argument is `undefined` when it could not be resolved (e.g. a
	 * destroyed execution context or a value `jsonValue()` cannot serialize).
	 * Always empty for `"pageerror"` entries.
	 */
	args: unknown[];
	/** Source location of the message, or `undefined` when unavailable (always `undefined` for `"pageerror"`). */
	location?: { url?: string; lineNumber?: number; columnNumber?: number };
	/** Stack trace text, present only for `"pageerror"` entries. */
	stack?: string;
	/** Timestamp (ms since epoch) when the message was captured. */
	ts: number;
}

/**
 * An error event emitted during crawling or scraping.
 */
export interface CrawlerError {
	/** The process ID where the error occurred. */
	pid: number;

	/** Whether the error occurred in the main process (as opposed to a sub-process). */
	isMainProcess: boolean;

	/** The URL being processed when the error occurred, or `null` if not applicable. */
	url: string | null;

	/** Whether the error occurred while processing an external (out-of-scope) URL. */
	isExternal: boolean;

	/** The error object. */
	error: Error;
}
