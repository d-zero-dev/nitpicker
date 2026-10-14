# @nitpicker/core

Nitpicker の計算コアを Rust（Node-API、[napi-rs](https://napi.rs/)）で実装したネイティブアドオンです。重い計算をここに集め、[@nitpicker/archive](../archive/README.md) などの TypeScript パッケージから呼び出します。現在はページ本文の内容ハッシュ（`page_meta.body_hash`）と、テンプレート分類（ページのシグナルと HTML から、ページごとのテンプレートキーとクラスタごとの reason まで）を提供しています。

## 対応プラットフォーム

ビルド済みバイナリだけを配布し、JavaScript のフォールバックはありません。対応しているのは次の 2 つです。

| プラットフォーム                      | バイナリを含むパッケージ                                         |
| ------------------------------------- | ---------------------------------------------------------------- |
| macOS（Apple silicon）                | [@nitpicker/core-darwin-arm64](../core-darwin-arm64/README.md)   |
| Linux x64・glibc 2.28 以上（WSL2 可） | [@nitpicker/core-linux-x64-gnu](../core-linux-x64-gnu/README.md) |

glibc 2.28 は Node.js 24 自体の Linux バイナリと同じ下限です。上記以外（Intel Mac、linux-arm64、musl、Windows ネイティブ）では、読み込んだ時点で対応表を含むエラーを出して終了します。プラットフォーム別パッケージは `optionalDependencies` で入るため、`--omit=optional` / `--no-optional` を付けてインストールすると読み込めません。

## 使い方

公開 API は 1 関数 1 サブパスで export しています。

```ts
import { computeBodyHash } from '@nitpicker/core/compute-body-hash';

const a = computeBodyHash(Buffer.from('<body><a href="/p/a1b2c3d4">x</a></body>'));
const b = computeBodyHash(Buffer.from('<body><a href="/p/z9y8x7w6">x</a></body>'));
a.equals(b); // true — 動的 ID はマスクしてからハッシュする
```

テンプレート分類は、呼び出し側（`@nitpicker/archive` の `resolvePageClusterKeys`）がコーパスを読んで順に渡して実行します。全ページのシグナル（URL パス・スタイルシート・ホスト）を渡してブロック分け（Pass 0）し、続けて全ページの HTML をコーパス順に渡します。計算する呼び出しはアドオン内のスレッドプールで動き、Promise を返します。呼び出しは重ねず、1 つずつ await します。

```ts
import { createTemplateClassificationRun } from '@nitpicker/core/create-template-classification-run';

const run = createTemplateClassificationRun();
run.pushSignals([
	{ paths: ['news', '1'], stylesheetHrefs: [] },
	{ paths: ['news', '2'], stylesheetHrefs: [] },
]);
await run.block();
await run.pushPages([
	{ html: '<body><main><p>a</p></main></body>' },
	{ html: '<body><main><p>b</p></main></body>' },
]);
await run.finishPages();
const { keys, keyOfPage, reasons } = await run.takeOutput();
keys[keyOfPage[0]!]; // '["path:news","cluster:0"]'
```

ブロックは既定で全ページをクラスタリングします。次の 2 つの場合だけ、そのブロックを `TEMPLATE_BLOCK_SAMPLE_SIZE`（`@nitpicker/core/template-block-sample-size`）ページのサンプルでクラスタリングします。

- Stage A の類似度表（`n * (n - 1) / 2 * 8` バイト、`n` はブロックのページ数）が `memoryBudget` を超える。`memoryBudget` は `createTemplateClassificationRun` のオプションで、既定は `TEMPLATE_MEMORY_BUDGET`（`@nitpicker/core/template-memory-budget`、512 MiB）、0 なら全ブロックが対象になる。
- 全ページで計算するブロックの合計が `TEMPLATE_EXACT_PAGE_LIMIT`（`@nitpicker/core/template-exact-page-limit`、20,000 ページ）を超える。この場合は、標本より大きい（100 ページを超える）ブロックを、ページ数が多い順（同数なら出現順）に、収まるまで対象にする。100 ページ以下のブロックはサンプルにしても保持ページが減らないので対象にならず、それだけで上限を超えるときは超えたまま保持する。上限は固定で、利用者は変えられない。

既定の 512 MiB は、約 11,500 ページのブロックまでの類似度表に当たります。1 ページの解析結果は最大で約 60 KB です。同じ切り取りの深さはトークンを共有し、本文は圧縮して持つので、通常はこれより小さくなります。20,000 ページなら最大で約 1.2 GB を、ブロックの計算が終わるまで抱えます。どのブロックが落ちるかで保存される `templateKey` が決まるので、メモリ上限を変えると結果が変わります。既存のアーカイブは、`viewer-build` で再分類するまで以前のキーのままです。

サンプルに落としたブロックの残りのページは、2 回目の読み込み（`needsAssignment()` が true のときの `pushAssignmentPages`）で最も近いクラスタに割り当てます。落としたブロックは、`block()` の間に `block-sampled` の進捗イベントで 1 つずつ通知され、`takeOutput()` の `sampledBlocks` にも、理由（`table-over-budget` か `pages-over-limit`）つきで残ります。どちらの読み込みでも全ページをコーパス順に渡しますが、`pageMask()` が 0 のページは HTML を空文字にして構いません（HTML を読み出す必要もありません）。

## 開発

Rust ツールチェーンが必要です（バージョンはリポジトリルートの `rust-toolchain.toml` で固定。セットアップは [CONTRIBUTING.md](../../../CONTRIBUTING.md) を参照）。`yarn build` を実行すると、`scripts/build-native.mjs` がホスト向けのアドオンをビルドしてパッケージ直下に `core.<platform>.node` として置きます。ローダーはこのローカルビルドを先に探し、なければプラットフォーム別パッケージを読み込みます。

- Rust のコードは `crates/` 配下の Cargo workspace にあります。napi に依存するのは `nitpicker_napi`（公開関数だけの薄い層）だけで、計算本体の crate は `cargo test` だけでテストできます
- `yarn test:rust` で Rust のテスト、`yarn lint` で rustfmt と clippy も実行します
- body hash は既存アーカイブに保存済みの値と byte 単位で一致させています。`crates/nitpicker_html_scan/tests/fixtures/body-hash-golden.json` は `@nitpicker/archive` の `src/body-hash/` にある JavaScript 段階実装（parity テストの oracle）から生成した golden fixture です
- テンプレート分類（`crates/nitpicker_template_cluster`）も、既存アーカイブの `templateKey` と reason に一致させています。HTML は htmlparser2 12.0.0 の挙動を移植した `crates/nitpicker_html_parser` で読み、スタイルシートのホストは呼び出し側の `new URL(href).host` を使います。一致の確認は `@nitpicker/archive` の golden（`src/template-classification/golden/`）で行います
- `crates/nitpicker_html_parser` には生成した固定データが 2 つあります。どちらも、リポジトリが依存していない固定版のパッケージを scratch ディレクトリに入れ、そのディレクトリを引数に渡して生成します（手順と理由は各スクリプトの冒頭）
  - エンティティの表 `src/html_decode_tree.rs`: `node scripts/generate-html-decode-tree.mjs <entities@8.0.0 のディレクトリ>`。デコードを意図して変えるときだけ再生成します
  - パーサーの比較基準 `tests/htmlparser2-fixture-events.tsv`: `node scripts/record-htmlparser2-events.mjs <htmlparser2@12.0.0 のディレクトリ>`。`@nitpicker/archive` の `page-cluster/__fixtures__/` を変えたときに取り直します

## 関連リンク

- [Nitpicker README](../../../README.md)
- [ARCHITECTURE.md](../../../ARCHITECTURE.md)

## ライセンス

Apache-2.0
