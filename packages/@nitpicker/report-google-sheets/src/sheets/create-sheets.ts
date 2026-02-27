import type { CreateSheet } from './types.js';
import type { Lanes } from '@d-zero/dealer';
import type { Sheet, Sheets, Cell } from '@d-zero/google-sheets';
import type { Archive, Page } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import c from 'ansi-colors';

import { sheetLog } from '../debug.js';
import { hasPropFilter } from '../utils/has-prop-filter.js';

const SEND_CHUNK_SIZE = 2500;

/**
 * 行データを Google Sheets に送信する。行数が {@link SEND_CHUNK_SIZE} を超える場合は
 * チャンク分割して逐次送信する。
 * @param sheet
 * @param rows
 * @param name
 * @param lanes
 * @param laneId
 * @param onProgress 送信の進捗を 0.0〜1.0 の fraction で通知するコールバック。
 *   Phase 2/3 のヘッダー加重平均に送信進捗を反映させるために使用する。
 */
async function sendRowsInChunks(
	sheet: Sheet,
	rows: Cell[][],
	name: string,
	lanes: Lanes | undefined,
	laneId: number,
	onProgress?: (fraction: number) => void,
) {
	if (rows.length <= SEND_CHUNK_SIZE) {
		lanes?.update(laneId, `${name}: Sending ${rows.length} rows%dots%`);
		onProgress?.(1);
		await sheet.addRowData(rows, true);
	} else {
		let sent = 0;
		for (let i = 0; i < rows.length; i += SEND_CHUNK_SIZE) {
			const chunk = rows.slice(i, i + SEND_CHUNK_SIZE);
			sent += chunk.length;
			const pct = Math.round((sent / rows.length) * 100);
			lanes?.update(
				laneId,
				`${name}: Sending rows ${sent}/${rows.length} (${pct}%)%dots%`,
			);
			onProgress?.(sent / rows.length);
			await sheet.addRowData(chunk, true);
		}
	}
}

/**
 * Parameters for {@link createSheets}.
 */
export interface CreateSheetsParams {
	/** Google Sheets API ラッパー */
	readonly sheets: Sheets;
	/** クロール結果のアーカイブ */
	readonly archive: Archive;
	/** 監査プラグインのレポート配列 */
	readonly reports: Report[];
	/** getPagesWithRefs のバッチサイズ（デフォルト 100,000） */
	readonly limit: number;
	/** シート設定のファクトリ関数配列 */
	readonly createSheetList: CreateSheet[];
	/** Lanes インスタンスを含むオプション */
	readonly options?: {
		/** Lanes instance for terminal progress display. */
		readonly lanes: Lanes;
	};
}

/**
 * Google Sheets にシートを作成し、データを投入してフォーマットする。
 *
 * ## 処理フェーズ
 *
 * 5つのフェーズで構成され、Phase 2+3 と Phase 4 は並列実行される:
 *
 * ```
 * Phase 1 (Creating sheets)
 *   → Phase 2 (Processing pages) ─→ Phase 3 (Processing resources)
 *   → Phase 4 (Plugin data / addRows)  ← Phase 2+3 と並列
 * → Phase 5 (Formatting sheets)
 * ```
 *
 * ## Lanes 進捗表示
 *
 * ### ヘッダー: 加重平均による集計
 *
 * Phase 2/3 のヘッダーは全子タスク（シート）の進捗を加重平均で集計する。
 *
 * 以前の実装では `Math.min()` で最遅シートのページ生成進捗のみを表示していたが、
 * シートごとに「生成完了→行送信中」「まだ生成中」「送信完了」と異なるサブフェーズに
 * いる場合、ヘッダーの数値と各レーンの表示が乖離する問題があった。
 * 例: ヘッダー「174/755 (23%)」だが Page List は既に Sent、
 * Referrers RT は Sending rows 7500/13256 — ヘッダーが全体を見ていない。
 *
 * 解決策として、各シートの進捗を 0.0〜1.0 の fraction で管理し、
 * 全シートの平均値をヘッダーに表示する:
 *
 * - **生成フェーズ**: `(pageNum / max) * 0.5` → 0%〜50%
 * - **送信フェーズ**: `0.5 + (sentRows / totalRows) * 0.5` → 50%〜100%
 *   (`sendRowsInChunks` の `onProgress` コールバック経由)
 * - **完了**: 1.0 (100%)
 *
 * 生成と送信を 50:50 で重み付けしている理由:
 * - 生成だけで 0〜100% にすると、全シートが生成完了（100%）になっても
 *   送信が残っている状態で「100%」と表示されてしまう
 * - 送信（特に大量行のチャンク送信）は Google API の
 *   レート制限により生成と同程度の時間がかかるため、等配分が妥当
 *
 * ### レーン: フェーズ遷移に応じた状態表示
 *
 * - **アクティブフェーズ内で完了 + 将来フェーズあり**: `c.green("Sent (N rows)")`
 * - **アクティブフェーズ内で完了 + 全フェーズ完了**: `c.green("Done (N rows)")`
 * - **非アクティブ + 完了済み**: `c.dim` で同じテキスト（色だけ変化、Waiting に戻らない）
 * - **非アクティブ + 未着手**: `c.dim("Waiting...")`
 * @param params - シート作成に必要なパラメータ
 */
export async function createSheets(params: CreateSheetsParams) {
	const { sheets, archive, reports, limit, createSheetList, options } = params;
	if (!createSheetList) {
		sheetLog('createSheetList is empty');
		return;
	}

	const lanes = options?.lanes;
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
		createSheetList.map((createSheet) => createSheet(reports)),
	);
	sheetLog(
		'Sheet settings initialized: %O',
		settings.map((s) => s.name),
	);

	// Filter variables (early declaration for phase counting)
	const preEachPageRoutineList = settings.filter(hasPropFilter('preEachPage'));
	const eachPageRoutineList = settings.filter(hasPropFilter('eachPage'));
	const eachResourceRoutineList = settings.filter(hasPropFilter('eachResource'));
	const addRowsSettings = settings.filter((s) => s.addRows);
	const updateSheetSettings = settings.filter((s) => s.updateSheet);
	const needsPageIteration =
		preEachPageRoutineList.length > 0 || eachPageRoutineList.length > 0;

	sheetLog(
		'Routines: preEachPage=%d, eachPage=%d, eachResource=%d',
		preEachPageRoutineList.length,
		eachPageRoutineList.length,
		eachResourceRoutineList.length,
	);

	// Phase tracking
	const phaseLabels: string[] = ['Creating sheets'];
	if (needsPageIteration) phaseLabels.push('Processing pages');
	if (eachResourceRoutineList.length > 0) phaseLabels.push('Processing resources');
	if (updateSheetSettings.length > 0) phaseLabels.push('Formatting sheets');
	const totalPhases = phaseLabels.length;
	let currentPhase = 0;

	/**
	 * Advances to the next phase and updates the Lanes header line.
	 * @param detail - Optional custom text; defaults to the phase label.
	 */
	function setPhaseHeader(detail?: string) {
		currentPhase++;
		const prefix = c.bold(`[${currentPhase}/${totalPhases}]`);
		lanes?.header(`${prefix} ${detail ?? phaseLabels[currentPhase - 1]}`);
	}

	/**
	 * Updates the Lanes header text without advancing the phase counter.
	 * @param detail - New header text (e.g. progress percentage).
	 */
	function updatePhaseHeader(detail: string) {
		const prefix = c.bold(`[${currentPhase}/${totalPhases}]`);
		lanes?.header(`${prefix} ${detail}`);
	}

	// Completion tracking
	const completionDetails = new Map<string, string>();
	let phase4Complete = false;

	/**
	 * Returns the sequential phase numbers (2, 3, 5) that the named sheet
	 * participates in. Used to determine whether a sheet has future work
	 * remaining (for "Sent" vs "Done" labeling).
	 * @param name - The sheet display name.
	 */
	function getSeqPhases(name: string): number[] {
		const phases: number[] = [];
		if (
			eachPageRoutineList.some((s) => s.name === name) ||
			preEachPageRoutineList.some((s) => s.name === name)
		)
			phases.push(2);
		if (eachResourceRoutineList.some((s) => s.name === name)) phases.push(3);
		if (updateSheetSettings.some((s) => s.name === name)) phases.push(5);
		return phases;
	}

	/**
	 * Marks a sheet as completed for the current phase and updates its
	 * lane display. Shows "Sent" if future phases remain, "Done" otherwise.
	 * @param name - The sheet display name.
	 * @param detail - Optional detail text (e.g. row count).
	 */
	function markDone(name: string, detail?: string) {
		completionDetails.set(name, detail ?? '');
		const id = getSheetId(name);
		const hasFuture = getSeqPhases(name).some((p) => p > currentPhase);
		if (hasFuture) {
			lanes?.update(id, c.green(`${name}: Sent${detail ? ` (${detail})` : ''}`));
		} else {
			lanes?.update(id, c.green(`${name}: Done${detail ? ` (${detail})` : ''}`));
		}
	}

	/**
	 * Formats a status string for a completed sheet, choosing
	 * "Sent" or "Done" based on whether future phases remain.
	 * @param name - The sheet display name.
	 */
	function formatSheetStatus(name: string): string {
		const detail = completionDetails.get(name);
		const hasFuture = getSeqPhases(name).some((p) => p > currentPhase);
		if (hasFuture) {
			return `${name}: Sent${detail ? ` (${detail})` : ''}`;
		}
		return `${name}: Done${detail ? ` (${detail})` : ''}`;
	}

	/**
	 * Dims lane displays for sheets that are not active in the given phase.
	 * Completed sheets show their status in dim color; unstarted sheets
	 * show "Waiting...". Phase 4 (addRows) sheets are left bright while
	 * that phase is still running since it executes in parallel.
	 * @param seqPhaseNum - The current sequential phase number (2, 3, or 5).
	 */
	function dimInactiveSheets(seqPhaseNum: number) {
		for (const setting of settings) {
			const name = setting.name;
			const seqPhases = getSeqPhases(name);

			// このフェーズでアクティブ → スキップ
			if (seqPhases.includes(seqPhaseNum)) continue;

			// Phase 4 がまだ実行中のシート → スキップ
			const inPhase4 = addRowsSettings.some((s) => s.name === name);
			if (inPhase4 && !phase4Complete) continue;

			const id = getSheetId(name);

			if (completionDetails.has(name)) {
				lanes?.update(id, c.dim(formatSheetStatus(name)));
			} else {
				lanes?.update(id, c.dim(`${name}: Waiting...`));
			}
		}
	}

	// Phase 1: Create sheets + set headers
	sheetLog('Phase 1: Creating %d sheet(s) and setting headers', settings.length);
	setPhaseHeader();
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
			sheetLog('[%s] Headers set (%d columns)', name, headers.length);
			lanes?.update(id, `${name}: Ready`);
		}),
	);
	sheetLog('Phase 1 complete');

	await Promise.all([
		(async () => {
			// Phase 2: Page processing (preEachPage + eachPage unified)
			if (needsPageIteration) {
				sheetLog('Phase 2: Starting page iteration');
				setPhaseHeader();
				dimInactiveSheets(2);
				sheetLog('Loading pages from archive (limit=%d)', limit);
				const sheetProgress = new Map<string, number>();
				for (const setting of preEachPageRoutineList) {
					sheetProgress.set(setting.name, 0);
				}
				for (const setting of eachPageRoutineList) {
					sheetProgress.set(setting.name, 0);
				}

				/**
				 * Recalculates and displays the weighted-average progress
				 * across all page-processing sheets for the Phase 2 header.
				 */
				function updatePhase2Header() {
					if (sheetProgress.size === 0) return;
					const avg =
						[...sheetProgress.values()].reduce((a, b) => a + b, 0) / sheetProgress.size;
					const pct = Math.round(avg * 100);
					updatePhaseHeader(`Processing pages (${pct}%)`);
				}

				await archive.getPagesWithRefs(limit, async (pages, offset, max) => {
					sheetLog(
						'Batch received: %d pages (offset=%d, total=%d)',
						pages.length,
						offset,
						max,
					);
					updatePhase2Header();

					// preEachPage first
					if (preEachPageRoutineList.length > 0) {
						sheetLog(
							'Running preEachPage for %d routine(s)',
							preEachPageRoutineList.length,
						);
						await Promise.all(
							preEachPageRoutineList.map(async (setting) => {
								const id = getSheetId(setting.name);
								let num = 1;
								let prevPage: Page | null = null;
								for (const page of pages) {
									const pageNum = offset + num;
									lanes?.update(
										id,
										`${setting.name}: Pre-processing ${pageNum}/${max}%dots%`,
									);
									sheetProgress.set(setting.name, pageNum / max);
									updatePhase2Header();
									await setting.preEachPage(page, pageNum, max, prevPage);
									prevPage = page;
									num++;
								}
							}),
						);
						sheetLog('preEachPage complete for batch (offset=%d)', offset);
					}

					// eachPage second
					if (eachPageRoutineList.length > 0) {
						sheetLog('Running eachPage for %d routine(s)', eachPageRoutineList.length);
						await Promise.all(
							eachPageRoutineList.map(async (setting) => {
								const id = getSheetId(setting.name);
								let num = 1;
								const rows: Cell[][] = [];
								const name = setting.name;
								let prevPage: Page | null = null;
								for (const page of pages) {
									const pageNum = offset + num;
									lanes?.update(id, `${name}: Generating row ${pageNum}/${max}%dots%`);
									sheetProgress.set(name, (pageNum / max) * 0.5);
									updatePhase2Header();
									const data = await setting.eachPage(page, pageNum, max, prevPage);
									prevPage = page;
									if (!data) {
										num++;
										continue;
									}
									for (const row of data) {
										rows.push(row);
									}
									num++;
								}
								sheetLog(
									'[%s] Sending %d rows (offset=%d/%d)',
									name,
									rows.length,
									offset,
									max,
								);
								const sheet = await sheets.create(name);
								await sendRowsInChunks(sheet, rows, name, lanes, id, (fraction) => {
									sheetProgress.set(name, 0.5 + fraction * 0.5);
									updatePhase2Header();
								});
								sheetLog('[%s] Send complete (offset=%d)', name, offset);
								sheetProgress.set(name, 1);
								updatePhase2Header();
								markDone(name, `${rows.length} rows`);
							}),
						);
					}
				});
				sheetLog('Phase 2 complete');
			}

			// Phase 3: Resource processing
			if (eachResourceRoutineList.length > 0) {
				sheetLog('Phase 3: Starting resource processing');
				setPhaseHeader();
				dimInactiveSheets(3);
				const resources = await archive.getResources();
				sheetLog('Resources loaded: %d', resources.length);
				const resourceProgress = new Map<string, number>();
				for (const setting of eachResourceRoutineList) {
					resourceProgress.set(setting.name, 0);
				}

				/**
				 * Recalculates and displays the weighted-average progress
				 * across all resource-processing sheets for the Phase 3 header.
				 */
				function updatePhase3Header() {
					if (resourceProgress.size === 0) return;
					const avg =
						[...resourceProgress.values()].reduce((a, b) => a + b, 0) /
						resourceProgress.size;
					const pct = Math.round(avg * 100);
					updatePhaseHeader(`Processing resources (${pct}%)`);
				}

				await Promise.all(
					eachResourceRoutineList.map(async (setting) => {
						const id = getSheetId(setting.name);
						const sheet = await sheets.create(setting.name);
						const rows: Cell[][] = [];
						let i = 0;
						for (const resource of resources) {
							i++;
							lanes?.update(
								id,
								`${setting.name}: Processing ${i}/${resources.length}%dots%`,
							);
							resourceProgress.set(setting.name, (i / resources.length) * 0.5);
							updatePhase3Header();
							const resourceData = await setting.eachResource(resource);
							if (resourceData) {
								rows.push(...resourceData);
							}
						}
						sheetLog('[%s] Sending %d resource rows', setting.name, rows.length);
						await sendRowsInChunks(sheet, rows, setting.name, lanes, id, (fraction) => {
							resourceProgress.set(setting.name, 0.5 + fraction * 0.5);
							updatePhase3Header();
						});
						sheetLog('[%s] Resource send complete', setting.name);
						resourceProgress.set(setting.name, 1);
						updatePhase3Header();
						markDone(setting.name, `${rows.length} rows`);
					}),
				);
				sheetLog('Phase 3 complete');
			}
		})(),
		(async () => {
			// Phase 4: Plugin data (addRows)
			if (addRowsSettings.length > 0) {
				sheetLog('Phase 4: Processing %d addRows routine(s)', addRowsSettings.length);
				await Promise.all(
					addRowsSettings.map(async (setting) => {
						const name = setting.name;
						const id = getSheetId(name);
						sheetLog('[%s] Creating plugin data', name);
						lanes?.update(id, `${name}: Writing plugin data%dots%`);
						const data = await setting.addRows!();
						if (!data) {
							sheetLog('[%s] Plugin data is empty', name);
							return;
						}
						const sheet = await sheets.create(name);
						sheetLog('[%s] Sending %d rows', name, data.length);
						await sendRowsInChunks(sheet, data, name, lanes, id);
						sheetLog('[%s] Plugin data send complete', name);
						if (!completionDetails.has(name)) {
							markDone(name, `${data.length} rows`);
						}
					}),
				);
				phase4Complete = true;
				sheetLog('Phase 4 complete');
			}
		})(),
	]);

	// Phase 5: Formatting
	if (updateSheetSettings.length > 0) {
		sheetLog('Phase 5: Formatting %d sheet(s)', updateSheetSettings.length);
		setPhaseHeader();
		dimInactiveSheets(5);
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
				markDone(name);
			}),
		);
		sheetLog('Phase 5 complete');
	}
}
