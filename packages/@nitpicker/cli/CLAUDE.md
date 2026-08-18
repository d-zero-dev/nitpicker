# @nitpicker/cli - AI Agent Guide

## Output display design principle（出力表示の設計原則）

長時間処理を持つコマンド（crawl / viewer-build / analyze 等）の進捗表示は、以下を必ず守る。

### 無音区間ゼロ

- **処理ステップが始まったら、必ずその時点で表示を更新する**。「最後の進捗行（例: `59/59 (100%)`）のまま次のステップに入る」は禁止 — 止まったのと区別がつかない
- 数値進捗が構造的に出せない区間（単一の同期 SQL、トランザクション COMMIT、WAL checkpoint、tar 圧縮等）も、**フェーズラベル + アニメーションプレースホルダー**（`%dots%` / `%braille%`）を表示する
- 新しい処理ステップを追加したら、開始時の表示更新をセットで実装する。レビュー時は「この await の間、画面には何が出ているか」を各ステップで確認する

### 非 verbose（デフォルト）

- `@d-zero/dealer` の `Lanes` の単一行上書き表示に push する（`stream: process.stderr`）
- 進捗行（`N/M (x%)`）にも `%braille%` prefix を付けて生存表示する — 更新が疎な区間で静止して見えないように
- タイムスタンプは付けない（上書き行に履歴はないため相関に使えず、ちらつくだけ）

### verbose（`--verbose`）

- **`Lanes` の verbose 機能（`new Lanes({ verbose: true })`）を使う** — 上書き表示が 1 行ずつの追記出力に切り替わり、アニメーションプレースホルダーは dealer 側（`riffle`）が自動で除去する。CLI 側で `console.error` 直書きに分岐しない（表示の抽象は Lanes に一本化する）
- 各行に ISO 8601 タイムスタンプを prefix する（どのステップにどれだけ時間がかかったかの唯一の記録になる）

### stdout / stderr の使い分け

- 進捗・状態表示は stderr、コマンドのデータ出力（JSON 等）は stdout。パイプ利用（`nitpicker query ... | jq`）を壊さない
