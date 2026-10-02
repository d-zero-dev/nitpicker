import type { I18nValue } from '../types.js';

/**
 * The status code Nitpicker records when a page could not be fetched at all
 * (DNS failure, timeout, connection reset, ...). It is an internal sentinel,
 * not an HTTP status, so it must never reach the screen as a bare `-1`.
 */
export const FETCH_ERROR_STATUS = -1;

/**
 * Human-readable label for a page's status: the internal fetch-failure
 * sentinel (`-1`) reads as "Fetch error" / 取得エラー, every real HTTP status
 * stays numeric. `null` / `undefined` (status never recorded) yield `null`
 * so each caller keeps its own placeholder.
 * @param status - The recorded status, or `null` / `undefined` when absent.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The label, or `null` when there is no status to label.
 * @example
 * getStatusLabel(200, t); // => '200'
 * getStatusLabel(-1, t); // => 'Fetch error' (ja: '取得エラー')
 * getStatusLabel(null, t); // => null
 */
export function getStatusLabel(
	status: number | null | undefined,
	t: I18nValue['t'],
): string | null {
	if (status === null || status === undefined) {
		return null;
	}
	return status === FETCH_ERROR_STATUS ? t('common.statusFetchError') : String(status);
}
