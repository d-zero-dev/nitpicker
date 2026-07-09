# analyze

`.nitpicker` アーカイブに分析プラグインを実行し、結果をアーカイブへ書き戻します。

## 基本形

```sh
npx @nitpicker/cli analyze <archive>.nitpicker [options]
```

例:

```sh
npx @nitpicker/cli analyze ./site.nitpicker --all
npx @nitpicker/cli analyze ./site.nitpicker --plugin @nitpicker/analyze-axe
```

`--all` または `--plugin` を指定しないTTY環境では、実行するプラグインを対話選択します。非TTY環境では詳細ログが有効になり、CIでエラー内容を確認しやすくなります。

## プラグイン選択

| 方法              | 説明                                     |
| ----------------- | ---------------------------------------- |
| `--all`           | 設定済みの分析プラグインをすべて実行     |
| `--plugin <name>` | 指定したプラグインだけ実行。複数指定可能 |
| フラグなし        | TTYでは対話選択                          |

## オプション一覧

| オプション                | 型                 | 説明                                                                        |
| ------------------------- | ------------------ | --------------------------------------------------------------------------- |
| `--all`                   | boolean            | すべての分析プラグインを実行                                                |
| `--plugin`                | string, repeatable | 実行するプラグイン名を指定                                                  |
| `--verbose`               | boolean            | 詳細ログを出力                                                              |
| `--search-keywords`       | string, repeatable | `analyze-search` の検索キーワードを設定ファイルより優先                     |
| `--search-scope`          | string             | `analyze-search` の検索範囲CSSセレクタを設定ファイルより優先                |
| `--main-content-selector` | string             | `analyze-main-contents` のメインコンテンツCSSセレクタを設定ファイルより優先 |
| `--axe-lang`              | string             | `analyze-axe` のBCP 47言語タグを設定ファイルより優先                        |
| `--silent`                | boolean            | 標準出力ログを抑制                                                          |
