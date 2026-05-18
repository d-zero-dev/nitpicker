import type { Lanes } from '@d-zero/dealer';
import type { Cell, Sheet } from '@d-zero/google-sheets';

/**
 * チャンク 1 個あたりの送信行数。Google Sheets API への 1 リクエストで
 * 含める行数の上限。大きすぎると HTTP リクエストボディの gzip 圧縮で
 * メモリを圧迫するため、控えめな値を採用している。
 */
const SEND_CHUNK_SIZE = 2500;

/**
 * ストリーミング送信用バッファのハンドル。
 *
 * `push()` で 1 行ずつ受け取り、バッファが {@link SEND_CHUNK_SIZE} に達すると
 * 即 `sheet.addRowData()` を呼んでフラッシュする。Phase 2/3 で全件蓄積する
 * のではなく、生成と送信を交互に進めることでピークメモリを抑える。
 */
export interface RowStreamer {
	/**
	 * バッファに行を追加する。閾値に達した時点で自動フラッシュする。
	 * @param rows
	 */
	push(rows: Cell[][]): Promise<void>;
	/**
	 * バッファに残った行を送信し切る。ループ終了後に必ず呼ぶこと。
	 */
	flush(): Promise<void>;
	/**
	 * これまでに送信済みの累計行数。
	 */
	readonly sent: number;
}

/**
 * 指定したシート宛のストリーミング送信ハンドルを作成する。
 *
 * 進捗表示はそのシートのレーンに `Sent N rows so far` 形式で
 * 更新する（{@link Lanes} 未指定なら表示は省略）。
 * @param sheet 送信先 {@link Sheet}
 * @param name シート表示名（進捗ログ用）
 * @param lanes ターミナル進捗表示用 {@link Lanes}、未指定なら表示省略
 * @param laneId このシート用のレーン ID
 */
export function createRowStreamer(
	sheet: Sheet,
	name: string,
	lanes: Lanes | undefined,
	laneId: number,
): RowStreamer {
	const buffer: Cell[][] = [];
	let sent = 0;

	/**
	 *
	 */
	async function flushChunk() {
		const chunk = buffer.splice(0, SEND_CHUNK_SIZE);
		await sheet.addRowData(chunk, true);
		sent += chunk.length;
		lanes?.update(laneId, `${name}: Sent ${sent} rows so far%dots%`);
	}

	return {
		async push(rows) {
			for (const row of rows) {
				buffer.push(row);
			}
			while (buffer.length >= SEND_CHUNK_SIZE) {
				await flushChunk();
			}
		},
		async flush() {
			while (buffer.length > 0) {
				await flushChunk();
			}
		},
		get sent() {
			return sent;
		},
	};
}
