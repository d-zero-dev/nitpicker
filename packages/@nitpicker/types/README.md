# @nitpicker/types

Nitpicker プラグイン向けの共有 TypeScript 型定義。

## 概要

analyze プラグインやレポーターが共通で使用する型定義（`Report`、`ConfigJSON` など）を提供します。

このパッケージは [Nitpicker](../../README.md) モノレポの内部パッケージです。単体での利用は想定していません。

## エクスポート

| パス                        | 内容                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `@nitpicker/types`          | `Report`、`Violation`、`Discrepancy`、`ConfigJSON` 等の共通型定義             |
| `@nitpicker/types/to-error` | `toError()` — unknown な例外値を `Error` インスタンスに変換するユーティリティ |

## ライセンス

Apache-2.0
