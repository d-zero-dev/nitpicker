# @nitpicker/crawler

ヘッドレスブラウザでWebサイトをクロールし、`.nitpicker` アーカイブを生成・更新する内部パッケージです。アーカイブ自体の読み書き（スキーマ・マイグレーション・concat / split 等）は [@nitpicker/archive](../archive/README.md) が担い、このパッケージはクロールの制御（puppeteer / beholder / dealer）だけを持ちます。

通常は [@nitpicker/cli](../cli/README.md) の `crawl` コマンドから利用します。

## 関連リンク

- [Nitpicker README](../../../README.md)
- [CLI crawl docs](../cli/docs/crawl.md)
- [ARCHITECTURE.md](../../../ARCHITECTURE.md)

## ライセンス

Apache-2.0
