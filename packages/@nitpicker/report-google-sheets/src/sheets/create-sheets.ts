import type { CreateSheet } from './types.js';
import type { StepContext, TaskListPipeline } from '@d-zero/dealer';
import type { ErrorHandlerMessage, Sheets } from '@d-zero/google-sheets';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import { TaskList } from '@d-zero/dealer';
import { requireViewerReadModel } from '@nitpicker/query';

import { sheetLog } from '../debug.js';
import { dedupeProgressMessage } from '../dedupe-progress-message.js';
import { formatProgressCount } from '../format-progress-count.js';

import { createCellData } from './create-cell-data.js';
import { defaultCellFormat } from './default-cell-format.js';
import { CELL_BUDGET_LIMIT, estimateCellBudget } from './estimate-cell-budget.js';

/** A `write()`-only sink that renders nothing, for `options.silent`. */
const NULL_STREAM: NodeJS.WritableStream = {
	write: () => true,
	on: () => NULL_STREAM,
	off: () => NULL_STREAM,
} as unknown as NodeJS.WritableStream;

/**
 * Parameters for {@link createSheets}.
 */
export interface CreateSheetsParams {
	/** Google Sheets API ラッパー */
	readonly sheets: Sheets;
	/** アーカイブへの read-only アクセサ */
	readonly accessor: ArchiveAccessor;
	/** 監査プラグインのレポート配列 */
	readonly reports: Report[];
	/**
	 * シート設定のファクトリ関数配列。**配列の順序がそのままセル予算の優先順位になる**
	 * — 呼び出し元（`report.ts`）がユーザー選択をこの優先順位で並べ替えてから渡す。
	 */
	readonly createSheetList: CreateSheet[];
	readonly options?: {
		/**
		 * Plain-text warning sink (e.g. cell-budget truncation notices).
		 * `report.ts` wires this to `process.stderr.write` — `create-sheets.ts`
		 * itself stays UI-agnostic.
		 */
		readonly onWarn?: (message: string) => void;
		/** Render target for the `TaskList` display. Defaults to `process.stderr`. Overridable so tests don't render to the real terminal. */
		readonly stream?: NodeJS.WritableStream;
		/** Passed to `TaskList.run()` — append-only output instead of cursor overwrite. Defaults to `!process.stdout.isTTY`. */
		readonly verbose?: boolean;
		/** When `true`, suppresses the `TaskList` display entirely (routes it to a no-op stream) — every other behavior is unchanged. */
		readonly silent?: boolean;
	};
}

/**
 * Google Sheets にシートを作成し、データを投入してフォーマットする。
 *
 * ## タスクリスト構成
 *
 * `@d-zero/dealer` の `TaskList`（逐次パイプライン）で、選択されたシートの数だけ
 * 動的にステップを積む — 固定行数ではなくユーザー選択に応じて可変:
 *
 * ```
 * Create sheet: <name>  ×N（ヘッダ設定まで）
 * Estimate cell budget   ×1（`estimateCellBudget` の事前警告 + 予算初期値の算出）
 * Insert rows: <name>   ×N（行生成 + 実送信。両者は同じステップの中で起きる）
 * Format sheet: <name>  ×M（`updateSheet` を持つシートのみ）
 * ```
 *
 * 全ステップが厳密に逐次実行されるため、Google Sheets API へのリクエストが並列に
 * 飛ばない（レート制限への配慮）のと同時に、シート作成順・書式適用順も予測可能になる。
 *
 * `Insert rows: <name>` の中で Google Sheets へ実際に届くリクエストは、2500 行の
 * チャンクごとに「グリッド拡張 + `updateCells`」（`@d-zero/google-sheets` の
 * `Sheet#addRowData`）だけ——`sheet.appendRow()` はバッファが 2500 行に達した
 * 時点でその場で送るため、行生成（メモリ内処理）とその送信（ネットワーク往復）は
 * 別ステップに分けられない。`run()` 自身が呼ぶ `sheet.flush()` もそのまま生きた
 * 実装で動く。ステップ末尾で TRUNCATED マーカー行（truncation 時のみ）を追記した
 * 後に改めて呼ぶ `flush()` は、バッファが空なら no-op になる契約
 * （`@d-zero/google-sheets` 側）なので無条件に呼んでよい。セル予算のデクリメント
 * （`sheet.sentCount` 実測）はこのステップ自身の戻り値で次のシートへ渡す。
 *
 * ## セル予算配分（report OOM 修正・Google Sheets 10M セル上限対策）
 *
 * `Estimate cell budget` ステップで全シートの見積もり行数から超過見込みを警告表示する
 * （`options.onWarn`）。実際の予算執行は `Insert rows: <name>` ステップ間でパイプラインの
 * 搬送値（残セル数）を実測（`sheet.sentCount`）でデクリメントしながら受け渡す —
 * `maxRows = floor(残セル数 / 列数)` を各シート開始時に確定し、優先順位の高い
 * シートの未使用分が後続シートに回る。`run()` が `maxRows` に達すると自身の
 * ループを打ち切り、打ち切られたシートには TRUNCATED マーカー行を追記する。
 *
 * ## 進捗表示（行数ベース、% 付き）
 *
 * `run()` は `ctx.onProgress(sent, total)` を都度呼び、`total` は
 * `ctx.estimatedTotal`（`estimateRowCount()` の結果）が正——`maxRows`（セル予算の
 * 打ち切り上限）ではない。`formatProgressCount` で `"1,234/5,000 rows (25%)"`
 * 形式に整形し、`dedupeProgressMessage` で同一文字列の連続再描画を間引く
 * （百万行規模のシートで毎行再描画するとターミナルが埋まる）。`sheet.onProgress`
 * （`@d-zero/google-sheets` 側、チャンク単位のコールバック）も同時に配線しており、
 * `appendRow()` の自動 flush が完了するたびに表示を更新する。
 *
 * ただし `onProgress` はチャンクの `batchUpdate` 完了**後**にしか発火しない
 * ため、そのネットワーク往復自体（数秒〜数十秒かかりうる）は無音区間になる。
 * 総行数が `SEND_CHUNK_SIZE`（2500）の倍数でない限り、`run()` 自身の
 * `onProgress` は最終行をバッファへ積んだ時点で `100%` を表示してしまい、
 * 直後のステップ末尾の明示 `flush()` 呼び出し（残りバッファの実送信）が
 * ちょうどこの無音区間に当たる——`100%` のまま応答が止まって見える原因。
 * そのため `flush()` 呼び出し直前に `sheet.pendingCount`（未送信バッファ行数）
 * を使って `"flushing N rows..."` という一時メッセージを出し、無反応に見える
 * 区間を作らない。
 *
 * Google Sheets API のレート制限（429/403/5xx/ECONNRESET）による待機は
 * `sheets.onLog` 経由で検知し、その時点で実行中のステップの行に一時的に上書き表示
 * する（`active`）— 待機中は該当行が数十秒止まって見えるため、原因を明示する。
 *
 * ## 行送信戦略（lazy cell 全廃）
 *
 * 各シートの `run()` はページ/リソース/違反等を自分でストリームしながら、生成した
 * 行を都度 `sheet.appendRow(...)` に渡す。`sheet.appendRow()` は
 * `@d-zero/google-sheets` 側で 2500 行ごとに自動 flush する。遅延セル
 * （`createCellData(() => ...)` の thunk）はこの契約では一切使わない — 遅延セルが
 * 1つでもバッチに混入すると、明示的な `flush()` を呼ぶまで自動 flush が停止し、
 * バッチ全体が無制限にメモリへ滞留する（`create-cell-data.ts` の docs 参照）。
 * 各列の値は現在のカーソル行 1 件だけから同期的に決定できるため、この停止条件は
 * 構造的に発生しない。
 * @param params - シート作成に必要なパラメータ
 */
export async function createSheets(params: CreateSheetsParams) {
	const { sheets, accessor, reports, createSheetList, options } = params;
	if (!createSheetList) {
		sheetLog('createSheetList is empty');
		return;
	}
	const onWarn = options?.onWarn;

	sheetLog('Initializing %d sheet setting(s)', createSheetList.length);
	const settings = await Promise.all(
		createSheetList.map((createSheet) => createSheet(reports, accessor)),
	);
	sheetLog(
		'Sheet settings initialized: %O',
		settings.map((s) => s.name),
	);

	if (settings.length === 0) {
		sheetLog('No sheets selected');
		return;
	}

	if (settings.some((s) => s.requiresReadModel)) {
		sheetLog('At least one selected sheet requires the viewer read model — checking');
		await requireViewerReadModel(accessor);
	}

	const updateSheetSettings = settings.filter((s) => s.updateSheet);
	const headerColumnsByName = new Map<string, number>();
	let estimatedRowsByName = new Map<string, number>();

	// Rate-limit backoff routes onto whichever TaskList row is currently
	// running: Google's API can pause a request for tens of seconds, and the
	// operator needs to see *why* that row looks stalled instead of assuming
	// it's hung. Overwritten by the row's own next progress update once the
	// wait resolves and the retry succeeds — there is nothing to restore here
	// when `message.waiting` is `false`.
	let active: ((message: string) => void) | null = null;
	let countdownSeq = 0;
	sheets.onLog = (message: ErrorHandlerMessage) => {
		if (!message.waiting || !message.waitTime) {
			return;
		}
		const id = countdownSeq++;
		const label =
			message.message === 'TooManyRequestError'
				? 'Too Many Requests (429)'
				: message.message === 'UserRateLimitExceededError'
					? 'Rate Limit Exceeded (403)'
					: message.message === 'ServerError'
						? `Server Error (${message.code ?? '5xx'})`
						: 'Connection Reset';
		active?.(`${label}: waiting %countdown(${message.waitTime}, rateLimit_${id}, s)%s`);
	};

	// Carries the remaining cell budget (in cells) between steps, threaded
	// through the whole pipeline as a `number` — Phase 1's "Create sheet"
	// steps and Phase 3's "Format" steps don't care about it and pass it
	// through unchanged; only "Estimate cell budget" and Phase 2's "Insert rows"
	// steps actually read/update it. A single consistent carried type avoids
	// the `StepFn<T, R>` mismatches a per-phase type change would cause when
	// reassigning back into one `let pipeline` across the loop below (see
	// `cli`'s CLAUDE.md note on annotating `TaskList` step types explicitly).
	let pipeline: TaskListPipeline<number> = TaskList.from(0);

	// Phase 1: create every selected sheet and set its headers, unconditionally
	// — regardless of whether the cell budget will later let it send any rows.
	for (const setting of settings) {
		pipeline = pipeline.pipe(
			`Create sheet: ${setting.name}`,
			async (input: number, ctx: StepContext<number>): Promise<number> => {
				active = dedupeProgressMessage((message) => ctx.progress(message));
				active('creating...');
				const sheet = await sheets.create(setting.name);
				active('setting headers...');
				const headers = await setting.createHeaders();
				await sheet.setHeaders(headers);
				headerColumnsByName.set(setting.name, headers.length);
				return input;
			},
		);
	}

	// Advisory warning (informational only — see estimate-cell-budget.ts's
	// docs for why the real enforcement below uses live sentCount instead of
	// these estimates) + the initial cell budget every "Insert rows" step decrements.
	pipeline = pipeline.pipe(
		'Estimate cell budget',
		async (_input: number, ctx: StepContext<number>): Promise<number> => {
			active = dedupeProgressMessage((message) => ctx.progress(message));
			active('counting rows per sheet...');
			const estimates = await Promise.all(
				settings.map(async (setting) => ({
					name: setting.name,
					columns: headerColumnsByName.get(setting.name) ?? 0,
					estimatedRows: await setting.estimateRowCount(),
				})),
			);
			const allocations = estimateCellBudget(estimates);
			estimatedRowsByName = new Map(allocations.map((a) => [a.name, a.estimatedRows]));
			const anyTruncated = allocations.some((a) => a.truncated);
			if (anyTruncated) {
				const summary = allocations
					.filter((a) => a.truncated)
					.map(
						(a) =>
							`  - ${a.name}: ~${a.estimatedRows} rows estimated, budget allows ~${a.maxRows}`,
					)
					.join('\n');
				onWarn?.(
					`Warning: this report's estimated size exceeds Google Sheets' 10,000,000-cell ` +
						`document limit. The following sheet(s) will be truncated:\n${summary}\n`,
				);
			}
			// Header-row cost for every selected sheet is already spent in
			// Phase 1, unconditionally — subtracted up front, mirroring
			// estimate-cell-budget.ts's own up-front header deduction.
			const headerCost = allocations.reduce((sum, a) => sum + a.columns, 0);
			const remainingCells = Math.max(0, CELL_BUDGET_LIMIT - headerCost);
			active(`${remainingCells.toLocaleString()} cells remaining`);
			return remainingCells;
		},
	);

	// Phase 2: run every sheet's `run()` in priority order (array order),
	// sequentially — each sheet's actual sent-row count decrements the
	// shared remaining-cell budget (carried as this step's input/output)
	// before the next sheet starts, so an earlier sheet sending fewer rows
	// than its allocation lets the remainder roll over to the next sheet.
	//
	// Every actual Sheets API access in this phase is one thing, repeated
	// per 2500-row chunk: grow the grid, then `updateCells` it
	// (`@d-zero/google-sheets`'s `Sheet#addRowData`, reached both by
	// `appendRow()`'s own auto-flush and by the explicit `flush()` call
	// below). Row generation and that network round trip cannot be split
	// into separate steps — `appendRow()` sends as it goes — so each sheet
	// gets a single step here, not a "build" step followed by an "upload"
	// step.
	for (const setting of settings) {
		pipeline = pipeline.pipe(
			`Insert rows: ${setting.name}`,
			async (remainingCells: number, ctx: StepContext<number>): Promise<number> => {
				active = dedupeProgressMessage((message) => ctx.progress(message));
				const columns = headerColumnsByName.get(setting.name) ?? 0;
				const maxRows =
					columns > 0 ? Math.max(0, Math.floor(remainingCells / columns)) : 0;

				if (maxRows <= 0) {
					sheetLog('[%s] Skipped: cell budget exhausted', setting.name);
					active('skipped (cell budget exhausted)');
					onWarn?.(
						`Warning: "${setting.name}" was skipped entirely — the cell budget was already exhausted by higher-priority sheets.\n`,
					);
					return remainingCells;
				}

				sheetLog('[%s] Running (maxRows=%d)', setting.name, maxRows);
				const sheet = await sheets.create(setting.name);
				// Real per-chunk numbers for whichever flush is in flight —
				// `appendRow()`'s own 2500-row auto-flush during `run()` below,
				// and the explicit `flush()` call after it, can each be a
				// multi-second network round trip with no other progress
				// signal until they resolve.
				sheet.onProgress = (chunkSent: number, remaining: number) => {
					active?.(formatProgressCount(chunkSent, chunkSent + remaining, 'rows'));
				};

				const estimatedRows = estimatedRowsByName.get(setting.name) ?? 0;
				let sent = 0;
				active('inserting...');
				await setting.run({
					sheet,
					maxRows,
					estimatedTotal: estimatedRows,
					onProgress: (progressSent, total) => {
						sent = progressSent;
						active?.(formatProgressCount(sent, total, 'rows'));
					},
				});

				// Truncation is decided live, against this sheet's own maxRows as
				// actually computed above — not against Phase 1.5's advisory
				// `truncated` flag, which can go stale: an earlier sheet sending
				// more or fewer rows than *its own* estimate predicted shifts how
				// much budget later sheets really get, so a sheet the advisory
				// pass scored as "not truncated" can still be cut short for real.
				const truncated = sent >= maxRows && estimatedRows > maxRows;
				if (truncated) {
					await sheet.appendRow([
						createCellData(
							{
								value: `TRUNCATED: this sheet was cut off at ${sent} rows to stay under Google Sheets' 10,000,000-cell document limit.`,
							},
							defaultCellFormat,
						),
					]);
				}
				// `run()` already flushes its own tail per the
				// `CreateSheetSetting.run()` contract — this call only drains
				// the TRUNCATED marker row appended above, if any. `flush()`
				// is a no-op on an empty buffer, so calling it unconditionally
				// here is safe either way.
				//
				// `run()`'s own onProgress already reported 100% once the last
				// row was buffered (see this function's JSDoc) — without this,
				// the display would sit frozen at 100% for the entire network
				// round trip below, with nothing to show it's still working.
				if (sheet.pendingCount > 0) {
					active?.(`flushing ${sheet.pendingCount.toLocaleString()} rows...`);
				}
				await sheet.flush();
				if (truncated) {
					onWarn?.(
						`Warning: "${setting.name}" was truncated at ${sent} rows (cell budget).\n`,
					);
				}

				sheetLog('[%s] Done (%d rows sent)', setting.name, sheet.sentCount);
				return Math.max(0, remainingCells - sheet.sentCount * columns);
			},
		);
	}

	// Phase 3: formatting.
	for (const setting of updateSheetSettings) {
		pipeline = pipeline.pipe(
			`Format sheet: ${setting.name}`,
			async (input: number, ctx: StepContext<number>): Promise<number> => {
				active = dedupeProgressMessage((message) => ctx.progress(message));
				active('applying formatting...');
				const sheet = await sheets.create(setting.name);
				await setting.updateSheet!(sheet);
				await sheet.overwriteHeaderFormat();
				return input;
			},
		);
	}

	await pipeline.run({
		stream: options?.silent ? NULL_STREAM : (options?.stream ?? process.stderr),
		verbose: options?.verbose ?? !process.stdout.isTTY,
		keepElapsed: true,
	});
}
