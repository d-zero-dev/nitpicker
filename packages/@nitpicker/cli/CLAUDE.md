# @nitpicker/cli - AI Agent Guide

## Output display design principle（出力表示の設計原則）

長時間処理を持つコマンド（crawl / viewer-build / analyze 等）の進捗表示は、以下を必ず守る。

### 無音区間ゼロ

- **処理ステップが始まったら、必ずその時点で表示を更新する**。「最後の進捗行（例: `59/59 (100%)`）のまま次のステップに入る」は禁止 — 止まったのと区別がつかない
- 数値進捗が構造的に出せない区間（単一の同期 SQL、トランザクション COMMIT、WAL checkpoint、tar 圧縮等）も、**フェーズラベル + アニメーションプレースホルダー**（`%dots%` / `%braille%`、`Lanes` 経由の表示のみ。`TaskList` の行は不要 — 下記参照）を表示する
- 新しい処理ステップを追加したら、開始時の表示更新をセットで実装する。レビュー時は「この await の間、画面には何が出ているか」を各ステップで確認する

### TaskList か Lanes か

- **逐次処理（既知のステップ列を順番にこなす）は `@d-zero/dealer` の `TaskList`** — `[ ]`→`[%taskSpin%]`→`done`/`error` のタスクリスト表示。crawl の起動ログ（setup フェーズ、`crawl/create-setup-task-list.ts`）・crawl 完了後の後処理（`crawl/run-post-crawl-task-list.ts`）・`viewer-build` 全体がこれに該当する
  - `TaskList` の行は `[%taskSpin%]` アイコン自体がスピナーなので、`ctx.progress()` に渡すメッセージに `%braille%`/`%dots%` を埋め込まない（二重アニメーションになる）。行の名前（`name: message` の `name` 部分）は dealer が自動整形するので、message 側にラベルを重複させない
  - `TaskList.pipe()`/`.pipe()` の各ステップ関数は、`(input, ctx)` の型を明示的に注釈する（`StepContext<R>` 等）。無注釈だと TypeScript が `ctx: StepContext<R>` と戻り値の相互参照から `R` を `unknown` に落とすことがある
  - クロージャ内でのみ代入する `let` 変数（例: `initializedCallback` の中で埋める display ハンドル）は、TypeScript の narrowing が `never` に落とすことがあるため、単一の `let` ではなくオブジェクトの property として持つ（`const state = { display: null as X | null }`）
- **並列処理（`@nitpicker/crawler` の `deal()` が駆動する crawl 本体）は現行の `Lanes` 単一行上書き表示のまま** — `deal()` 自体が並列レーン表示を持ち、逐次前提の `TaskList` は適用できない。CLI 側は `crawl/attach-crawl-display.ts` が `deal()` 完了までの `error`/`flushingPendingWrites`/`sortingUrls` イベントだけを中継する
- **`TaskList` と `Lanes`/`deal()` の同時稼働は禁止**（`Lanes`/`Display` の単一インスタンス制約、下記 ARCHITECTURE.md 参照）。`TaskList.run()` の pipe コールバック内で新しい `Lanes`/`deal()` を起動しない。crawl コマンドは `TaskList(起動ログ) → close → deal(crawl本体) → close → TaskList(後処理)` の厳密な逐次で、区間が重ならないことを都度確認する

### 非 verbose（デフォルト）

- `Lanes` ベースの表示は単一行上書きに push する（`stream: process.stderr`）。進捗行（`N/M (x%)`）にも `%braille%` prefix を付けて生存表示する — 更新が疎な区間で静止して見えないように
- `TaskList` ベースの表示はタスクリスト形式（複数行、行ごとに `[ ]`→`[%taskSpin%]`→`done`/`error`）
- タイムスタンプは付けない（上書き行・タスクリストどちらも既定表示に履歴の相関相手がなく、ちらつくだけ）

### verbose（`--verbose`）

- **`Lanes` ベースは `Lanes` の verbose 機能（`new Lanes({ verbose: true })`）を使う** — 上書き表示が 1 行ずつの追記出力に切り替わり、アニメーションプレースホルダーは dealer 側（`riffle`）が自動で除去する。CLI 側で `console.error` 直書きに分岐しない（表示の抽象は Lanes に一本化する）
- **`TaskList` ベースは `run({ verbose: true })` に加え、`stream` を `crawl/create-verbose-timestamp-stream.ts` の `createVerboseTimestampStream()` でラップする** — `TaskList` 自体はタイムスタンプを付けないため、行ごとの ISO 8601 タイムスタンプは stream ラッパー側の責務
- 各行に ISO 8601 タイムスタンプを prefix する（どのステップにどれだけ時間がかかったかの唯一の記録になる）

### stdout / stderr の使い分け

- 進捗・状態表示は stderr、コマンドのデータ出力（JSON 等）は stdout。パイプ利用（`nitpicker query ... | jq`）を壊さない
