# @nitpicker/report-google-sheets

クロール・分析結果を Google Sheets に出力するレポーター。

## 概要

`.nitpicker` アーカイブ内のクロールデータと分析結果を Google Sheets に出力します。ページ一覧・リンク・リソース・画像・違反レポートなど、複数のシートを自動生成します。

このパッケージは [Nitpicker](../../../README.md) モノレポの内部パッケージです。単体での利用は想定していません。

## 設計のポイント

- **5 フェーズ構成**: `Phase 1 (シート作成)` → `Phase 2 (ページ反復) / Phase 3 (リソース反復) / Phase 4 (プラグインデータ)` 並列 → `Phase 5 (フォーマット)`。詳細は [ARCHITECTURE.md §8](../../../ARCHITECTURE.md#8-report-の詳細)。
- **ストリーミング送信**: 各シートの行生成は `sheet.appendRow(...rows)` でストリーミング送信。`@d-zero/google-sheets` が内部で 2500 行ごとに自動 flush するため、呼び出し元のメモリ滞留はチャンクサイズ分に抑えられる。
- **Resources シートの dedupe モード**: `--dedupe-resources` で canonical URL ごとに集約。広告・解析タグで per-request unique なクエリが爆発するサイトで、Google Sheets の **1 ドキュメント 10,000,000 セル上限** を回避するための機能（実例: 1.6M raw → 63K rows、96% 削減）。
- **Phase 3 finalize での進捗表示**: 集約後の大量行を `appendRow(...finalRows)` で一括送信する間も、`Sheet.onProgress` を購読して chunk flush ごとに Lanes に `Sending N/total` を反映する。実装は [`src/sheets/run-finalize-resources.ts`](./src/sheets/run-finalize-resources.ts)。

## 拡張ポイント（新規シート追加時）

新しいシートを追加するときの典型パターン:

| やりたいこと                                   | 使う hook                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| ページごとに行を生成                           | `eachPage`                                                  |
| ページ反復前に状態を蓄積（例: 親子関係マップ） | `preEachPage`                                               |
| リソースごとに行を生成                         | `eachResource`                                              |
| リソース反復の終端で集約結果を 1 回だけ送信    | `eachResource` で Map に蓄積 → `finalizeResources` で flush |
| プラグインデータ等、反復不要で一括送信         | `addRows`（Phase 2/3 と並列実行）                           |
| データ送信後にフォーマット適用                 | `updateSheet`                                               |

> **集約系シートで `eachResource` 内の `num`/`total` を見て最後だけ emit する設計は禁止**。Phase 3 が将来並列化されると壊れる。必ず `finalizeResources` hook を使うこと（[ARCHITECTURE.md の説明](../../../ARCHITECTURE.md#行送信戦略)）。

## トラブルシューティング

| 症状                                                              | 原因と対処                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Error: This document is too large to continue editing.`          | Google Sheets の 10M セル上限到達。`--dedupe-resources` を有効にして Resources を集約する。                                                                                                                                                                                        |
| Phase 3 で「Sending N/total」の N が止まったまま                  | 進捗表示は `Sheet.onProgress` 駆動。`@d-zero/google-sheets` を 0.9.0 以上に保つ必要がある。                                                                                                                                                                                        |
| `RangeError: Maximum call stack size exceeded` (Phase 3 finalize) | `appendRow(...finalRows)` のスプレッドが V8 引数上限（実用上 6.5 万件付近）を超えた。`finalizeResources` の戻り値件数が更に増えた場合は chunk 単位で複数回 `appendRow` を呼ぶよう書き換える。[ARCHITECTURE.md の既知の制約セクション](../../../ARCHITECTURE.md#行送信戦略)を参照。 |
| sort に長時間ブロックされて HTTPS が EPIPE で落ちる               | `sortResourcesByUrl` は Pool `strnatcmp` の派生文字列ゼロ実装。`Intl.Collator.compare` や Schwartzian transform への書き換えは禁止（過去にやって両方とも本番障害を起こした）。詳細は [ARCHITECTURE.md](../../../ARCHITECTURE.md#行送信戦略)。                                      |

## テスト

```bash
yarn vitest run packages/@nitpicker/report-google-sheets
```

E2E は `yarn vitest run --config vitest.e2e.config.ts` でリポジトリ全体一括（Google Sheets API モックは未整備のため、本番送信パスは手動検証）。

## 参照

- [ARCHITECTURE.md §8 Report の詳細](../../../ARCHITECTURE.md#8-report-の詳細) — フェーズ詳細、行送信戦略、sort 実装の根拠
- [`@d-zero/google-sheets`](https://www.npmjs.com/package/@d-zero/google-sheets) — Sheet ストリーミング送信 API
- [Google Sheets API 制限](https://developers.google.com/sheets/api/limits) — 10M セル上限、batchUpdate サイズ
- [Martin Pool, "Natural Order String Comparison"](https://sourcefrog.net/projects/natsort/) — sort 実装の出典

## ライセンス

Apache-2.0
