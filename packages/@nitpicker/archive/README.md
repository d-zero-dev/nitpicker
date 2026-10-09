# @nitpicker/archive

`.nitpicker` アーカイブ（tar + SQLite）の読み書きを担う内部パッケージです。スキーマ定義・マイグレーション・`Archive` / `ArchiveAccessor`・tar 展開キャッシュ・concat / split・body hash・URL alias・技術スタック検出のロールアップ・テンプレート分類・スコープ判定・エラー分類を含みます。

ヘッドレスブラウザ（puppeteer / `@d-zero/beholder`）や `@d-zero/dealer` には依存しないため、読み取り専用の経路（[@nitpicker/query](../query/README.md)、viewer、mcp-server、report-\*）はクローラーを引き込まずにアーカイブを扱えます。クロール時の書き込みは [@nitpicker/crawler](../crawler/README.md) がこのパッケージ経由で行います。

## 使い方

公開 API は機能単位のサブパスで export しています（パッケージルート `.` の export はありません）。

```ts
import Archive from '@nitpicker/archive/archive';
import { classifyErrorKind } from '@nitpicker/archive/error-kind/classify-error-kind';

// `await using` が SQLite ハンドルを確実に閉じる
await using accessor = await Archive.openCached('/path/to/site.nitpicker');
const config = await accessor.getConfig();

console.log(classifyErrorKind('net::ERR_NAME_NOT_RESOLVED')); // 'dns'
```

利用可能なサブパスは `package.json` の `exports` を参照してください。

## 関連リンク

- [Nitpicker README](../../../README.md)
- [ARCHITECTURE.md](../../../ARCHITECTURE.md)

## ライセンス

Apache-2.0
