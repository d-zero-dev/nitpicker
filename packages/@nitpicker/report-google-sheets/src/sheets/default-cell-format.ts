/**
 * デフォルトのセルフォーマット設定。
 * テキストの折り返し戦略を `OVERFLOW_CELL` に設定し、
 * セル内容がセル幅を超える場合に隣接セルへ溢れるようにする。
 */
export const defaultCellFormat = Object.freeze({
	wrapStrategy: 'OVERFLOW_CELL' as const,
});
