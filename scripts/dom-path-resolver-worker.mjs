#!/usr/bin/env node
/**
 * `worker_threads` entry point for the dom-path resolver used by
 * `scripts/migrate-to-0.13.mjs`. Runs the jsdom parse + DOM walk for one
 * page per message, in its own V8 isolate.
 *
 * This exists only so the migration script can periodically
 * `terminate()` and respawn the worker. Every `JSDOM` instance runs its
 * `Window` in its own Node `vm` context, and V8 does not reliably
 * reclaim `vm` contexts through ordinary GC — even a forced
 * `globalThis.gc()` call — after `dom.window.close()` (measured: a
 * Mark-Compact pass reclaimed under 2 MB out of a 12 GB heap against a
 * real 380 K-image archive). Terminating the worker destroys its
 * isolate outright, which is the only way to give the memory back to
 * the OS.
 */

import { parentPort } from 'node:worker_threads';

import { JSDOM, VirtualConsole } from 'jsdom';

import { deriveDomPath } from '../packages/@nitpicker/crawler/lib/archive/populate-entity-tables/derive-dom-path.js';
import { matchImagesToDomPaths } from '../packages/@nitpicker/crawler/lib/archive/populate-entity-tables/match-images-to-dom-paths.js';

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});

parentPort.on('message', ({ id, pageId, htmlString, images }) => {
	parentPort.postMessage({ id, result: resolvePage(pageId, htmlString, images) });
});

/**
 * @param {number} pageId
 * @param {string | null} htmlString
 * @param {readonly { id: number, sourceCode: string | null }[]} images
 * @returns {Map<number, { path: string, case: string }>}
 */
function resolvePage(pageId, htmlString, images) {
	if (htmlString === null) {
		return fallbackAllUnknown(images, pageId, 'no HTML snapshot stored');
	}
	let dom;
	try {
		dom = new JSDOM(htmlString, { virtualConsole });
	} catch (error) {
		return fallbackAllUnknown(
			images,
			pageId,
			`jsdom parse failed: ${error?.message ?? error}`,
		);
	}
	try {
		const candidates = [...dom.window.document.querySelectorAll('img')].map((img) => ({
			outerHTML: img.outerHTML,
			path: deriveDomPath(img),
		}));
		const result = matchImagesToDomPaths(images, candidates);
		for (const [imageId, entry] of result) {
			if (entry.case === 'unknown') {
				console.warn(
					`[dom-path] unknown fallback for image id=${imageId} (page ${pageId})`,
				);
			}
		}
		return result;
	} finally {
		dom.window.close();
	}
}

/**
 * @param {readonly { id: number }[]} images
 * @param {number} pageId
 * @param {string} reason
 */
function fallbackAllUnknown(images, pageId, reason) {
	const map = new Map();
	for (const image of images) {
		map.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
		console.warn(
			`[dom-path] unknown fallback for image id=${image.id} (page ${pageId}): ${reason}`,
		);
	}
	return map;
}
