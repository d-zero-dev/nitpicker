import type { CreateSheet } from './types.js';
import type { Lanes } from '@d-zero/dealer';
import type { Sheets } from '@d-zero/google-sheets';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import { requireViewerReadModel } from '@nitpicker/query';
import c from 'ansi-colors';

import { sheetLog } from '../debug.js';

import { createCellData } from './create-cell-data.js';
import { defaultCellFormat } from './default-cell-format.js';
import { CELL_BUDGET_LIMIT, estimateCellBudget } from './estimate-cell-budget.js';

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
	/** Lanes インスタンスを含むオプション */
	readonly options?: {
		/** Lanes instance for terminal progress display. */
		readonly lanes?: Lanes;
		/**
		 * Plain-text warning sink (e.g. cell-budget truncation notices).
		 * `report.ts` wires this to `process.stderr.write` — `create-sheets.ts`
		 * itself stays UI-agnostic.
		 */
		readonly onWarn?: (message: string) => void;
	};
}

/**
 * Google Sheets にシートを作成し、データを投入してフォーマットする。
 *
 * ## 処理フェーズ
 *
 * ```
 * Phase 1 (Creating sheets)      -- 全シート並列
 *   → Phase 2 (Processing sheets) -- 優先順位順に直列実行
 * → Phase 3 (Formatting sheets)   -- 全シート並列
 * ```
 *
 * ## セル予算配分（report OOM 修正・Google Sheets 10M セル上限対策）
 *
 * Phase 2 の直前に `estimateCellBudget` で全シートの見積もり行数から超過見込みを
 * 警告表示する（`options.onWarn`）。実際の予算執行は Phase 2 の直列ループ内で
 * 残セル数を実測（`sheet.sentCount`）でデクリメントしながら行う —
 * `maxRows = floor(残セル数 / 列数)` を各シート開始時に確定し、優先順位の高い
 * シートの未使用分が後続シートに回る。`run()` が `maxRows` に達すると自身の
 * ループを打ち切り、打ち切られたシートには TRUNCATED マーカー行を追記する。
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

	const lanes = options?.lanes;
	const onWarn = options?.onWarn;
	let lineId = 0;
	const sheetIds = new Map<string, number>();

	/**
	 * Returns a stable numeric lane ID for the given sheet name.
	 * IDs are assigned sequentially on first access and cached.
	 * @param name - The sheet display name.
	 */
	function getSheetId(name: string) {
		let id = sheetIds.get(name);
		if (id == null) {
			id = lineId++;
			sheetIds.set(name, id);
		}
		return id;
	}

	sheetLog('Initializing %d sheet setting(s)', createSheetList.length);
	const settings = await Promise.all(
		createSheetList.map((createSheet) => createSheet(reports, accessor)),
	);
	sheetLog(
		'Sheet settings initialized: %O',
		settings.map((s) => s.name),
	);

	if (settings.some((s) => s.requiresReadModel)) {
		sheetLog('At least one selected sheet requires the viewer read model — checking');
		await requireViewerReadModel(accessor);
	}

	const updateSheetSettings = settings.filter((s) => s.updateSheet);
	const totalPhases = 2 + (updateSheetSettings.length > 0 ? 1 : 0);
	let currentPhase = 0;

	/**
	 * Advances to the next phase and updates the Lanes header line.
	 * @param detail - Optional custom text; defaults to the phase label.
	 */
	function setPhaseHeader(detail: string) {
		currentPhase++;
		const prefix = c.bold(`[${currentPhase}/${totalPhases}]`);
		lanes?.header(`${prefix} ${detail}`);
	}

	// Phase 1: Create sheets + set headers
	sheetLog('Phase 1: Creating %d sheet(s) and setting headers', settings.length);
	setPhaseHeader('Creating sheets');
	const headerColumnsByName = new Map<string, number>();
	await Promise.all(
		settings.map(async (setting) => {
			const name = setting.name;
			const id = getSheetId(name);
			sheetLog('[%s] Creating sheet via API', name);
			lanes?.update(id, `${name}: Creating sheet%dots%`);
			const sheet = await sheets.create(name);
			sheetLog('[%s] Setting headers', name);
			lanes?.update(id, `${name}: Setting headers%dots%`);
			const headers = await setting.createHeaders();
			await sheet.setHeaders(headers);
			headerColumnsByName.set(name, headers.length);
			sheetLog('[%s] Headers set (%d columns)', name, headers.length);
			lanes?.update(id, `${name}: Ready`);
		}),
	);
	sheetLog('Phase 1 complete');

	// Phase 1.5: Cell-budget advisory warning (informational only — see
	// estimate-cell-budget.ts's docs for why the real enforcement below
	// uses live sentCount instead of these estimates).
	sheetLog('Phase 1.5: Estimating cell budget for %d sheet(s)', settings.length);
	const estimates = await Promise.all(
		settings.map(async (setting) => ({
			name: setting.name,
			columns: headerColumnsByName.get(setting.name) ?? 0,
			estimatedRows: await setting.estimateRowCount(),
		})),
	);
	const allocations = estimateCellBudget(estimates);
	const estimatedRowsByName = new Map(allocations.map((a) => [a.name, a.estimatedRows]));
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
	sheetLog('Phase 1.5 complete (any truncated: %o)', anyTruncated);

	// Phase 2: run every sheet's `run()` in priority order (array order),
	// sequentially — each sheet's actual sent-row count decrements the
	// shared remaining-cell budget before the next sheet starts, so an
	// earlier sheet sending fewer rows than its allocation lets the
	// remainder roll over to the next sheet in priority order.
	sheetLog('Phase 2: Processing %d sheet(s) in priority order', settings.length);
	setPhaseHeader('Processing sheets');
	// Header-row cost for every selected sheet is already spent in Phase 1,
	// unconditionally — subtracted up front, mirroring
	// estimate-cell-budget.ts's own up-front header deduction.
	const headerCost = allocations.reduce((sum, a) => sum + a.columns, 0);
	let remainingCells = Math.max(0, CELL_BUDGET_LIMIT - headerCost);

	let processed = 0;
	for (const setting of settings) {
		processed++;
		const name = setting.name;
		const id = getSheetId(name);
		const columns = headerColumnsByName.get(name) ?? 0;
		const maxRows = columns > 0 ? Math.max(0, Math.floor(remainingCells / columns)) : 0;
		lanes?.header(
			`${c.bold(`[${currentPhase}/${totalPhases}]`)} Processing sheets (${processed}/${settings.length})`,
		);

		if (maxRows <= 0) {
			sheetLog('[%s] Skipped: cell budget exhausted', name);
			lanes?.update(id, c.yellow(`${name}: Skipped (cell budget exhausted)`));
			onWarn?.(
				`Warning: "${name}" was skipped entirely — the cell budget was already exhausted by higher-priority sheets.\n`,
			);
			continue;
		}

		sheetLog('[%s] Running (maxRows=%d)', name, maxRows);
		const sheet = await sheets.create(name);
		let sent = 0;
		const onProgress = (progressSent: number, total: number) => {
			sent = progressSent;
			lanes?.update(
				id,
				`${name}: Processing ${sent}/${total} (sent ${sheet.sentCount})%dots%`,
			);
		};
		await setting.run({ sheet, maxRows, onProgress });

		// Truncation is decided live, against this sheet's own maxRows as
		// actually computed above — not against Phase 1.5's advisory
		// `truncated` flag, which can go stale: an earlier sheet sending
		// more or fewer rows than *its own* estimate predicted shifts how
		// much budget later sheets really get, so a sheet the advisory pass
		// scored as "not truncated" can still be cut short for real here.
		const estimatedRows = estimatedRowsByName.get(name) ?? 0;
		if (sent >= maxRows && estimatedRows > maxRows) {
			await sheet.appendRow([
				createCellData(
					{
						value: `TRUNCATED: this sheet was cut off at ${sent} rows to stay under Google Sheets' 10,000,000-cell document limit.`,
					},
					defaultCellFormat,
				),
			]);
			await sheet.flush();
			onWarn?.(`Warning: "${name}" was truncated at ${sent} rows (cell budget).\n`);
		}

		remainingCells = Math.max(0, remainingCells - sheet.sentCount * columns);
		sheetLog('[%s] Done (%d rows sent)', name, sheet.sentCount);
		lanes?.update(id, c.green(`${name}: Done (${sheet.sentCount} rows)`));
	}
	sheetLog('Phase 2 complete');

	// Phase 3: Formatting
	if (updateSheetSettings.length > 0) {
		sheetLog('Phase 3: Formatting %d sheet(s)', updateSheetSettings.length);
		setPhaseHeader('Formatting sheets');
		await Promise.all(
			updateSheetSettings.map(async (setting) => {
				const name = setting.name;
				const id = getSheetId(name);
				sheetLog('[%s] Applying formatting', name);
				lanes?.update(id, `${name}: Applying formatting%dots%`);
				const sheet = await sheets.create(name);
				await setting.updateSheet!(sheet);
				await sheet.overwriteHeaderFormat();
				sheetLog('[%s] Formatting complete', name);
				lanes?.update(id, c.green(`${name}: Formatted`));
			}),
		);
		sheetLog('Phase 3 complete');
	}
}
