# @nitpicker/core

Nitpicker の計算コアを Rust（Node-API、[napi-rs](https://napi.rs/)）で実装したネイティブアドオンです。重い計算をここに集め、[@nitpicker/archive](../archive/README.md) などの TypeScript パッケージから呼び出します。現在は、ページ本文の内容ハッシュ（`page_meta.body_hash`）、HTML の構造シグナルによる技術検出、URL の自然順の順位付け、alias の判定、リンクの連結成分、テンプレート分類（ページのシグナルと HTML から、ページごとのテンプレートキーとクラスタごとの reason まで）、保存済み HTML スナップショットに対する CSS セレクタの照合（`query match-selector`）を提供しています。

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

フロントエンドフレームワークの構造シグナル（Next.js の `__NEXT_DATA__`、Vue の `data-v-*` など）は、`matchStructuralTechnologySignals` がページの HTML を 1 回走査して検出します。JS リソースの先頭にあるライセンスコメントは `matchJsLicenseCommentSignal` で照合します。フィンガープリントの一覧は `crates/nitpicker_tech_detect` が正です。

```ts
import { matchStructuralTechnologySignals } from '@nitpicker/core/match-structural-technology-signals';

matchStructuralTechnologySignals(Buffer.from('<div data-v-1a2b3c4d></div>'));
// [{ technology: 'Vue', signalType: 'scoped-attr', evidence: ' data-v-1a2b3c4d', weight: 40, category: 'JavaScript frameworks' }]
```

URL の自然順（`page2` が `page10` の前、大文字小文字・パーセントエンコードで順序が割れない、ホストが先でパスが後）は、`computeUrlSortRanks` が全件まとめて順位にします。URL は 1 回だけパースし、結果は入力順に依存しない全順序です（同じ URL は入力順）。順序の定義は `crates/nitpicker_url_key` の doc が正です。

```ts
import { computeUrlSortRanks } from '@nitpicker/core/compute-url-sort-ranks';

computeUrlSortRanks([
	'https://example.com/page10',
	'https://example.com/page2',
	'https://example.com/',
]); // Uint32Array [2, 1, 0]
```

同じページが別の URL で現れている組（`content_items.alias_of_id`）の判定には、URL からスキーム・ホストの大文字小文字・`/index.{ext}` をたたんだ Tier A キーと、さらに末尾スラッシュを落とした Tier B キーを使います。`computeAliasKeys` が 1 回のパースで両方を返し、`groupAliasCandidates` がキー・タイトル・本文ハッシュで連結成分にまとめて代表を選びます（グループ内を指す canonical が最多 → 最短 URL → UTF-16 の昇順）。

```ts
import { computeAliasKeys } from '@nitpicker/core/compute-alias-keys';

computeAliasKeys('http://Example.com/about/index.html');
// { tierA: 'example.com/about/', tierB: 'example.com/about' }
```

リンクでつながったページの連結成分は、`createIsolatedClusterRun` で求めます。辺は SQLite から読んだ分ずつ `unionEdges` に渡して捨てるので、メモリはページ数に比例し、辺の数には比例しません。リダイレクト先・alias の先に解決してから結び、終わりのない連鎖（ループ、ループに合流する尾）の辺は捨てます。成分の番号は候補の並び順で振られ、辺の順序や分け方に依存しません。

```ts
import { createIsolatedClusterRun } from '@nitpicker/core/create-isolated-cluster-run';

// 候補 10, 20, 30。ページ 40 は 30 へのリダイレクト元で候補ではない
const run = createIsolatedClusterRun([10, 20, 30], [40, 30]);
run.unionEdges([10, 20, 20, 40]);
run.labels(); // Uint32Array [0, 0, 0]
```

保存済み HTML スナップショットのセレクタ照合は、`matchSelectorSnapshots` がバッチ（`page_html_blobs` の行）を受け取り、zstd の展開から判定までをスレッドプールで並列に行って、スナップショットごとの判定を返します。同時に展開済みの文書を持つのは、スレッド数ぶんだけです。1 文書だけを同期で判定する `matchSelectorHtml` は、テストとベンチの段階比較のために出しています。判定は、必要なリテラルが順に現れるかの事前判定、開始タグだけで決まるセレクタの開始タグ走査、結合子と `:nth-*` のための開タグスタックの順で、最も安い厳密な手段を使います。タグ名と属性名は ASCII の大文字小文字だけを無視します。計画（`SelectorPlan`）の作り方と解釈規則は `@nitpicker/cli` の `docs/query.md` が正です。

```ts
import { matchSelectorSnapshots } from '@nitpicker/core/match-selector-snapshots';

const verdicts = await matchSelectorSnapshots({
	plan,
	snapshots: rows.map((row) => ({ body: row.body, codec: row.codec })),
});
verdicts[0]; // { matched: true, prefiltered: false, tokenized: false }
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
- body hash は既存アーカイブに保存済みの値と byte 単位で一致させています（例外は、本物の body より前に `<bodyguard>` のような `<body` で始まるカスタム要素があるページで、body の開始位置が変わるため値が変わります。#434）。`crates/nitpicker_html_scan/tests/fixtures/body-hash-golden.json` は `@nitpicker/archive` の `src/body-hash/` にある JavaScript 段階実装（parity テストの oracle）から生成した golden fixture です。Rust 側は正規化とマスクを 1 パスにまとめていて、段階版の Rust 関数と一致することを `tests/fused_body_hash_properties.rs` で確かめています
- 構造シグナルの技術検出（`crates/nitpicker_tech_detect`）は、既存アーカイブの `technology_signals` を書いた JavaScript 正規表現と同じシグナル・同じ順序・同じ evidence を返します。正規表現は JS の `u` フラグなしの意味論に合わせ、`\s` は JS が含める非 ASCII の空白（U+00A0・U+FEFF など）まで並べています。走査は、定義ごとの必須リテラルを Aho-Corasick で 1 回探し、見つかった定義だけを正規表現で確かめます。`tests/fixtures/technology-signals-golden.json` は `@nitpicker/archive` の `src/meta/technologies/structural-signal-definitions.ts`（parity テストの oracle）から `scripts/generate-technology-signals-golden.mjs` で生成した golden fixture です
- テンプレート分類（`crates/nitpicker_template_cluster`）も、既存アーカイブの `templateKey` と reason に一致させています。HTML は htmlparser2 12.0.0 の挙動を移植した `crates/nitpicker_html_parser` で読み、スタイルシートのホストは呼び出し側の `new URL(href).host` を使います。一致の確認は `@nitpicker/archive` の golden（`src/template-classification/golden/`）で行います
- URL の順序（`crates/nitpicker_url_key`）は、文字列から数値を取り出して 2 件ずつ比べる方式を採りません。その方式は推移律が崩れる（`a9` は `a10` より前、`a10` は `a1x` より前、`a1x` は `a9` より前になる）ためで、順序はバイト列キーの全順序として定義します。基準は、`tests/order_spec.rs`（期待順序の表）と `tests/order_properties.rs`（入力順不変・キーが同じ URL は生の URL 文字列の順・数値順などのプロパティテスト）です。順位は viewer の read model に保存されるので、順序の定義を変えるときは read model の schema version を上げます
- alias キー（`crates/nitpicker_url_key` の `alias_keys`）は、既存アーカイブの `content_items.alias_of_id` を作った JavaScript 実装のキーと一致させています。`tests/fixtures/alias-keys-golden.json` は `@nitpicker/archive` の `src/url-alias/` にある JavaScript 実装（parity テストの oracle）から `scripts/generate-alias-keys-golden.mjs` で生成した golden fixture で、キーは URL を書かれたまま（WHATWG URL の `pathname` と `search`）読むので、並べ替え用のキーとは別の読み方です。グルーピングと代表選定は、JavaScript の参照実装と突き合わせる parity テスト（`@nitpicker/archive` の `group-alias-candidates.parity.spec.ts`）で固めています
- 連結成分（`crates/nitpicker_union_find`）の成分は、辺の順序とバッチ分割に依存しません（`tests/components_properties.rs`）。成分の番号は候補の並び順だけで決まり、read model の `component_id` になるので、候補は page id の昇順で渡します
- セレクタ照合（`crates/nitpicker_html_scan` の `html_matches_selector` と `scan_snapshots`）の結果は永続化されないので、`docs/query.md` の解釈規則を正解にして書いています。`tag_tokenizer.rs` がタグを読み、direct 段（`run_direct_match.rs`）と開タグスタック（`run_selector_state_machine.rs`）が同じトークナイザを使います。開始タグの属性は、ブラウザのシリアライザの出力を読み戻せるよう HTML のトークナイザと同じ規則で読みます（`start_tag_attributes.rs`。ソースの引用符が欠けたページは属性名に `"` を含んで直列化されるため、引用符の対応だけでは開始タグの終わりを見失います）。正解は `@nitpicker/query` の oracle spec（直列化前の DOM の `querySelector`）です
- `crates/nitpicker_html_parser` には生成した固定データが 2 つあります。どちらも、リポジトリが依存していない固定版のパッケージを scratch ディレクトリに入れ、そのディレクトリを引数に渡して生成します（手順と理由は各スクリプトの冒頭）
  - エンティティの表 `src/html_decode_tree.rs`: `node scripts/generate-html-decode-tree.mjs <entities@8.0.0 のディレクトリ>`。デコードを意図して変えるときだけ再生成します
  - パーサーの比較基準 `tests/htmlparser2-fixture-events.tsv`: `node scripts/record-htmlparser2-events.mjs <htmlparser2@12.0.0 のディレクトリ>`。`@nitpicker/archive` の `page-cluster/__fixtures__/` を変えたときに取り直します

## 関連リンク

- [Nitpicker README](../../../README.md)
- [ARCHITECTURE.md](../../../ARCHITECTURE.md)

## ライセンス

Apache-2.0
