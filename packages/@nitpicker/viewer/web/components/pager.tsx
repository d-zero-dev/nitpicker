import type { PageSize } from '../types.js';
import type { PagerToken } from './build-pager-window.js';

import { useId, useState } from 'react';

import { applySetPage } from '../hooks/apply-set-page.js';
import { parsePageSize } from '../hooks/parse-page-size.js';
import { PAGE_SIZE_OPTIONS } from '../hooks/use-page-size.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';
import { buildPagerWindow } from './build-pager-window.js';
import { parseJumpTarget } from './parse-jump-target.js';

/** Props for {@link Pager}. */
export interface PagerProps {
	/** Current 1-indexed page. */
	currentPage: number;
	/** Total matching rows on the server. */
	total: number;
	/** Rows per page. */
	pageSize: PageSize;
	/** Called when the jump input requests a different page (1-indexed); the links navigate on their own. */
	onPageChange: (next: number) => void;
	/** Called when the user picks a new page size. */
	onPageSizeChange: (next: PageSize) => void;
}

/**
 * The MPA pagination footer: Prev / page-number links / Next / a jump-to
 * input / a page-size select / a textual `Page X of Y · {rows} rows` summary.
 *
 * Prev, Next and the page numbers are links to `?page=N` (other query
 * parameters kept, history entry replaced), so a page can be opened in a new
 * tab or shared as a URL. The jump input and the page-size select call
 * `onPageChange` / `onPageSizeChange`.
 *
 * Page-number links collapse around the current page via
 * {@link buildPagerWindow} so the strip stays bounded even at 10k+ pages.
 * Prev is a disabled link (`aria-disabled`, no `href`) at page 1; Next likewise
 * at the last page. The jump input is
 * a free-form number field — invalid entries are coerced to the nearest
 * valid page on submit.
 *
 * `aria-current="page"` marks the active number, and `aria-label`s come from
 * the i18n catalog so a screen reader announces "Page 4 of 42" rather than
 * "4 / 42".
 * @param props - Pagination state and handlers.
 * @returns The pager element.
 */
export function Pager(props: PagerProps) {
	const { currentPage, total, pageSize, onPageChange, onPageSizeChange } = props;
	const { t } = useI18n();
	const jumpInputId = useId();
	const sizeSelectId = useId();
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const clamped = Math.min(Math.max(1, currentPage), totalPages);
	const tokens = buildPagerWindow(totalPages, clamped);
	const [jumpValue, setJumpValue] = useState('');
	const [jumpInvalid, setJumpInvalid] = useState(false);

	const goTo = (next: number) => {
		const target = Math.min(Math.max(1, Math.floor(next)), totalPages);
		if (target !== clamped) {
			onPageChange(target);
		}
	};

	const submitJump = () => {
		const target = parseJumpTarget(jumpValue, totalPages);
		if (target === null) {
			// Don't clobber the user's typed value when it's not parseable —
			// they need to see what they typed to correct it. Surface invalidity
			// to screen readers via `aria-invalid`.
			setJumpInvalid(true);
			return;
		}
		setJumpInvalid(false);
		goTo(target);
		setJumpValue('');
	};

	// Page links keep the other filters and replace the history entry, like
	// `useCurrentPage().setPage` (paging is incremental state, not a new view).
	const { params } = useUrlFilter();
	const pageLink = (page: number) => ({ search: applySetPage(params, page).toString() });

	return (
		<nav className="pager" aria-label={t('pagination.navLabel')}>
			<div className="pager-controls">
				{clamped <= 1 ? (
					<span
						role="link"
						aria-disabled="true"
						className="pager-button pager-prev"
						aria-label={t('pagination.prev')}>
						‹ {t('pagination.prev')}
					</span>
				) : (
					<AppLink
						replace
						className="pager-button pager-prev"
						to={pageLink(clamped - 1)}
						aria-label={t('pagination.prev')}>
						‹ {t('pagination.prev')}
					</AppLink>
				)}
				<ol className="pager-list plain-list">
					{tokens.map((token) => renderToken(token, clamped, pageLink, t))}
				</ol>
				{clamped >= totalPages ? (
					<span
						role="link"
						aria-disabled="true"
						className="pager-button pager-next"
						aria-label={t('pagination.next')}>
						{t('pagination.next')} ›
					</span>
				) : (
					<AppLink
						replace
						className="pager-button pager-next"
						to={pageLink(clamped + 1)}
						aria-label={t('pagination.next')}>
						{t('pagination.next')} ›
					</AppLink>
				)}
			</div>
			<div className="pager-meta">
				<span aria-live="polite">
					{t('pagination.pageOf', {
						page: clamped.toLocaleString(),
						total: totalPages.toLocaleString(),
					})}{' '}
					·{' '}
					{t('pagination.totalRows', {
						total: total.toLocaleString(),
					})}
				</span>
				<form
					className="pager-jump"
					onSubmit={(event) => {
						event.preventDefault();
						submitJump();
					}}>
					<label htmlFor={jumpInputId} className="pager-label">
						{t('pagination.jumpTo')}
					</label>
					<input
						id={jumpInputId}
						type="number"
						min={1}
						max={totalPages}
						inputMode="numeric"
						value={jumpValue}
						placeholder={String(clamped)}
						onChange={(event) => {
							setJumpValue(event.target.value);
							setJumpInvalid(false);
						}}
						aria-label={t('pagination.jumpTo')}
						aria-invalid={jumpInvalid || undefined}
					/>
				</form>
				<label htmlFor={sizeSelectId} className="pager-label pager-size">
					{t('pagination.pageSize')}
					<select
						id={sizeSelectId}
						value={pageSize}
						onChange={(event) => {
							// Single source of truth — same validator the localStorage
							// reader uses, and both derive from `PAGE_SIZE_OPTIONS`
							// (which `PageSize` itself is derived from), so adding a new
							// size only needs that one array extended.
							const next = parsePageSize(Number(event.target.value));
							if (next !== null) {
								onPageSizeChange(next);
							}
						}}>
						{PAGE_SIZE_OPTIONS.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</label>
			</div>
		</nav>
	);
}

/**
 * Renders a single pager token (page number or ellipsis) as a `<li>`.
 * @param token - The token from {@link buildPagerWindow}.
 * @param currentPage - The active page, rendered as a non-link `aria-current` marker.
 * @param pageLink - Builds the `to` of the link to a page.
 * @param t - The i18n translate function.
 * @returns The list item element.
 */
function renderToken(
	token: PagerToken,
	currentPage: number,
	pageLink: (page: number) => { search: string },
	t: (key: string, params?: Record<string, string | number>) => string,
) {
	if (token === 'ellipsis-start' || token === 'ellipsis-end') {
		return (
			<li key={token} className="pager-ellipsis" aria-hidden={true}>
				…
			</li>
		);
	}
	if (token === currentPage) {
		// The active page is not a link: there is nowhere to go.
		return (
			<li key={token}>
				<span className="pager-button pager-number is-current" aria-current="page">
					{token}
				</span>
			</li>
		);
	}
	return (
		<li key={token}>
			<AppLink
				replace
				className="pager-button pager-number"
				to={pageLink(token)}
				aria-label={t('pagination.gotoPage', { page: token })}>
				{token}
			</AppLink>
		</li>
	);
}
