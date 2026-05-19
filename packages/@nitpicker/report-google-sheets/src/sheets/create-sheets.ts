import type { CreateSheet } from './types.js';
import type { Lanes } from '@d-zero/dealer';
import type { Sheets } from '@d-zero/google-sheets';
import type { Archive, Page } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import c from 'ansi-colors';

import { sheetLog } from '../debug.js';
import { hasPropFilter } from '../utils/has-prop-filter.js';

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
 * ## 行送信戦略
 *
 * Phase 2 / 3 はページ・リソースを反復しながら、生成した行を都度
 * `sheet.appendRow(...rows)` に渡してストリーミング送信する。`sheet.appendRow()` は
 * `@d-zero/google-sheets` 側で 2500 行ごとに自動 flush する（呼び出し元は
 * チャンクサイズを意識しない）。バッチ終端で `sheet.flush()` を呼んで残余を排出する。
 *
 * 遅延セル（`createCellData(() => ...)` の thunk）を含む行が混ざった場合、
 * `appendRow()` はその時点で自動 flush を停止し、明示的な `flush()` 呼び出しまで
 * バッファに保留する（順序保証）。Page List の「Internal Referrers」列がこの
 * 仕組みに乗っており、バッチ終端の `flush()` で初めて評価される。
 *
 * ## Lanes 進捗表示
 *
 * ### ヘッダー: 加重平均による集計
 *
 * Phase 2/3 のヘッダーは全子タスク（シート）の進捗 (`pageNum / max`) の
 * 平均をパーセント表示する。生成と送信が同一の `appendRow` 呼び出しで一体化
 * しているため、ヘッダーは単一の fraction で済む（旧実装にあった生成 0〜50% /
 * 送信 50〜100% の二段重み付けは不要になった）。
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
								const name = setting.name;
								const sheet = await sheets.create(name);
								let num = 1;
								let prevPage: Page | null = null;
								for (const page of pages) {
									const pageNum = offset + num;
									lanes?.update(
										id,
										`${name}: Processing ${pageNum}/${max} (sent ${sheet.sentCount})%dots%`,
									);
									sheetProgress.set(name, pageNum / max);
									updatePhase2Header();
									const data = await setting.eachPage(page, pageNum, max, prevPage);
									prevPage = page;
									if (data) {
										await sheet.appendRow(...data);
									}
									num++;
								}
								await sheet.flush();
								sheetLog(
									'[%s] Send complete (offset=%d, %d rows)',
									name,
									offset,
									sheet.sentCount,
								);
								sheetProgress.set(name, 1);
								updatePhase2Header();
								markDone(name, `${sheet.sentCount} rows`);
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
						const name = setting.name;
						const sheet = await sheets.create(name);
						let i = 0;
						for (const resource of resources) {
							i++;
							lanes?.update(
								id,
								`${name}: Processing ${i}/${resources.length} (sent ${sheet.sentCount})%dots%`,
							);
							resourceProgress.set(name, i / resources.length);
							updatePhase3Header();
							const resourceData = await setting.eachResource(resource);
							if (resourceData) {
								await sheet.appendRow(...resourceData);
							}
						}
						await sheet.flush();
						sheetLog('[%s] Resource send complete (%d rows)', name, sheet.sentCount);
						resourceProgress.set(name, 1);
						updatePhase3Header();
						markDone(name, `${sheet.sentCount} rows`);
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
						lanes?.update(id, `${name}: Sending ${data.length} rows%dots%`);
						await sheet.appendRow(...data);
						await sheet.flush();
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
