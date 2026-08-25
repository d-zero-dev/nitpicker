import type { CreateSheet } from './types.js';
import type { StepContext, TaskListPipeline } from '@d-zero/dealer';
import type { ErrorHandlerMessage, Sheet, Sheets } from '@d-zero/google-sheets';
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
 * Process: <name>       ×N（行生成のみ。flush はしない）
 * Upload: <name>        ×N（`Process` が `ctx.insertNext` で動的挿入。実際の
 *                            flush = Sheets API 送信を行う別ステップ）
 * Format: <name>        ×M（`updateSheet` を持つシートのみ）
 * ```
 *
 * 全ステップが厳密に逐次実行されるため、Google Sheets API へのリクエストが並列に
 * 飛ばない（レート制限への配慮）のと同時に、シート作成順・書式適用順も予測可能になる。
 * 行生成（メモリ内処理）と実送信（ネットワーク往復）は別プロセスなので、`Process`
 * ステップ内で `sheet.flush` を no-op に差し替えて `run()` からの明示的な flush
 * 呼び出しを無効化し（`appendRow()` 自身の 2500 行自動 flush は影響を受けない）、
 * `run()` 完了後に `Upload: <name>` を挿入して実際の flush をそこで行う —
 * セル予算のデクリメント（`sheet.sentCount` 実測）もこの `Upload` ステップの
 * 戻り値で行うため、`Process` の戻り値は暫定値のまま次段へ渡る。
 *
 * ## セル予算配分（report OOM 修正・Google Sheets 10M セル上限対策）
 *
 * `Estimate cell budget` ステップで全シートの見積もり行数から超過見込みを警告表示する
 * （`options.onWarn`）。実際の予算執行は `Upload: <name>` ステップ間でパイプラインの
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
 * （百万行規模のシートで毎行再描画するとターミナルが埋まる）。`Upload: <name>`
 * ステップ自身も「uploading to Google Sheets...」を表示するため、行生成完了から
 * 実送信完了までの間が無音区間にならない。
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
	// through unchanged; only "Estimate cell budget" and Phase 2's "Process"
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
	// these estimates) + the initial cell budget every "Process" step decrements.
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
	for (const setting of settings) {
		// Row generation ("Process") and the network upload ("Upload") are
		// different processes (in-memory computation vs. a Sheets API round
		// trip) — both are always-present, known-ahead-of-time steps for
		// every sheet (not a conditional/unplanned branch), so both are
		// pre-built here as regular sequential `.pipe()` steps, matching
		// Phase 1/3's "Create sheet"/"Format" steps. `ctx.insertNext` is
		// reserved for genuinely dynamic insertions (see `create-setup-task-
		// list.ts`'s recovery-label handling) — this pairing isn't that.
		// State that only "Upload" needs is handed off via this closure
		// variable rather than threading it through the pipeline's own
		// carried value, which stays a plain `number` (remaining budget)
		// throughout.
		let handoff: {
			readonly sheet: Sheet;
			readonly originalFlush: () => Promise<void>;
			readonly truncated: boolean;
			readonly sent: number;
			readonly columns: number;
		} | null = null;

		pipeline = pipeline.pipe(
			`Process: ${setting.name}`,
			async (remainingCells: number, ctx: StepContext<number>): Promise<number> => {
				active = dedupeProgressMessage((message) => ctx.progress(message));
				const columns = headerColumnsByName.get(setting.name) ?? 0;
				const budget = remainingCells;
				const maxRows = columns > 0 ? Math.max(0, Math.floor(budget / columns)) : 0;

				if (maxRows <= 0) {
					sheetLog('[%s] Skipped: cell budget exhausted', setting.name);
					active('skipped (cell budget exhausted)');
					onWarn?.(
						`Warning: "${setting.name}" was skipped entirely — the cell budget was already exhausted by higher-priority sheets.\n`,
					);
					return budget;
				}

				sheetLog('[%s] Running (maxRows=%d)', setting.name, maxRows);
				const sheet = await sheets.create(setting.name);
				// Defer every explicit `flush()` this sheet's `run()` makes
				// until the "Upload" step actually performs it — `appendRow()`'s
				// own automatic 2500-row auto-flush is untouched (it never
				// calls this public method).
				const originalFlush = sheet.flush.bind(sheet);
				sheet.flush = () => Promise.resolve();

				const estimatedTotal = estimatedRowsByName.get(setting.name) ?? 0;
				let sent = 0;
				await setting.run({
					sheet,
					maxRows,
					estimatedTotal,
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
				const estimatedRows = estimatedRowsByName.get(setting.name) ?? 0;
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

				handoff = { sheet, originalFlush, truncated, sent, columns };
				return budget;
			},
		);

		pipeline = pipeline.pipe(
			`Upload: ${setting.name}`,
			async (input: number, ctx: StepContext<number>): Promise<number> => {
				active = dedupeProgressMessage((message) => ctx.progress(message));
				if (!handoff) {
					active('skipped (cell budget exhausted)');
					return input;
				}
				const { sheet, originalFlush, truncated, sent, columns } = handoff;
				active('uploading to Google Sheets...');
				sheet.onProgress = (chunkSent: number, remaining: number) => {
					active?.(formatProgressCount(chunkSent, chunkSent + remaining, 'rows'));
				};
				await originalFlush();
				if (truncated) {
					onWarn?.(
						`Warning: "${setting.name}" was truncated at ${sent} rows (cell budget).\n`,
					);
				}
				sheetLog('[%s] Done (%d rows sent)', setting.name, sheet.sentCount);
				return Math.max(0, input - sheet.sentCount * columns);
			},
		);
	}

	// Phase 3: formatting.
	for (const setting of updateSheetSettings) {
		pipeline = pipeline.pipe(
			`Format: ${setting.name}`,
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
