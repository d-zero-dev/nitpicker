# @nitpicker/core

Nitpicker の計算コアを Rust（Node-API、[napi-rs](https://napi.rs/)）で実装したネイティブアドオンです。重い計算をここに集め、[@nitpicker/archive](../archive/README.md) などの TypeScript パッケージから呼び出します。現在はページ本文の内容ハッシュ（`page_meta.body_hash`）を提供しています。

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

## 開発

Rust ツールチェーンが必要です（バージョンはリポジトリルートの `rust-toolchain.toml` で固定。セットアップは [CONTRIBUTING.md](../../../CONTRIBUTING.md) を参照）。`yarn build` を実行すると、`scripts/build-native.mjs` がホスト向けのアドオンをビルドしてパッケージ直下に `core.<platform>.node` として置きます。ローダーはこのローカルビルドを先に探し、なければプラットフォーム別パッケージを読み込みます。

- Rust のコードは `crates/` 配下の Cargo workspace にあります。napi に依存するのは `nitpicker_napi`（公開関数だけの薄い層）だけで、計算本体の crate は `cargo test` だけでテストできます
- `yarn test:rust` で Rust のテスト、`yarn lint` で rustfmt と clippy も実行します
- body hash は旧 JavaScript 実装と byte 単位で一致させています。`crates/nitpicker_html_scan/tests/fixtures/body-hash-golden.json` は旧実装から生成した golden fixture です

## 関連リンク

- [Nitpicker README](../../../README.md)
- [ARCHITECTURE.md](../../../ARCHITECTURE.md)

## ライセンス

Apache-2.0
