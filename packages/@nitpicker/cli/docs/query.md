# query

`.nitpicker` アーカイブをJSONで問い合わせます。MCPサーバーと同じ `@nitpicker/query` の関数群をCLIから呼び出します。

## 基本形

```sh
npx @nitpicker/cli query <archive>.nitpicker <sub-command> [options]
```

例:

```sh
npx @nitpicker/cli query ./site.nitpicker summary --pretty
npx @nitpicker/cli query ./site.nitpicker pages --status-min 400 --pretty
npx @nitpicker/cli query ./site.nitpicker page-detail --url https://example.com/ --pretty
```

## 共通オプション

| オプション       | 型      | 説明               |
| ---------------- | ------- | ------------------ |
| `--limit`, `-l`  | number  | 最大取得件数       |
| `--offset`, `-o` | number  | スキップ件数       |
| `--pretty`       | boolean | JSONを整形して出力 |

`--limit` と `--offset` は対応するサブコマンドでのみ有効です。

## サブコマンド一覧

| サブコマンド                 | 用途                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `summary`                    | アーカイブ全体の概要統計                                          |
| `pages`                      | ページ一覧                                                        |
| `page-detail`                | 指定URLのページ詳細                                               |
| `html`                       | 指定URLのHTMLスナップショット                                     |
| `links`                      | broken/externalリンク一覧                                         |
| `resources`                  | ネットワークリソース一覧                                          |
| `images`                     | 画像一覧と画像品質フィルタ                                        |
| `violations`                 | 分析プラグインの違反結果                                          |
| `duplicates`                 | title/descriptionの重複                                           |
| `mismatches`                 | canonical/OGPメタデータの不一致                                   |
| `headers`                    | セキュリティヘッダー確認                                          |
| `resource-referrers`         | 指定リソースの参照元ページ                                        |
| `error-kinds`                | クロール失敗原因の集計                                            |
| `pages-by-tag`               | Wappalyzerタグに一致するページ                                    |
| `count-pages-by-tag`         | Wappalyzerタグに一致するページ数                                  |
| `pages-by-jsonld-type`       | JSON-LD typeに一致するページ                                      |
| `count-pages-by-jsonld-type` | JSON-LD typeに一致するページ数                                    |
| `tag-inventory`              | 検出タグの一覧                                                    |
| `page-jsonld`                | 指定URLのJSON-LD                                                  |
| `page-jsonld-overview`       | 指定URLのJSON-LD概要                                              |
| `page-tags`                  | 指定URLの検出タグ                                                 |
| `isolated-pages`             | inventory由来の完全孤立ページ                                     |
| `isolated-clusters`          | inventory由来の孤立クラスタ                                       |
| `get-isolated-cluster`       | 指定代表URLの孤立クラスタ詳細                                     |
| `unused-resources`           | 参照元がないinventory由来リソース                                 |
| `inventory-runs`             | inventory実行履歴                                                 |
| `console-logs`               | 捕捉したconsoleログ・ページエラー（内容ごとに全ページ横断で集約） |
| `page-console-logs`          | 指定URLのconsoleログ・ページエラー明細                            |

## サブコマンド別オプション

### `summary`

```sh
npx @nitpicker/cli query ./site.nitpicker summary --pretty
```

追加オプションはありません。

### `pages`

```sh
npx @nitpicker/cli query ./site.nitpicker pages --status-min 400 --sort-by url --sort-order asc --pretty
```

| オプション                | 型      | 説明                           |
| ------------------------- | ------- | ------------------------------ |
| `--status`                | number  | HTTP statusで完全一致          |
| `--status-min`            | number  | HTTP statusの下限              |
| `--status-max`            | number  | HTTP statusの上限              |
| `--is-external`           | boolean | external/internalで絞り込み    |
| `--content-type-category` | string  | content typeカテゴリで絞り込み |
| `--missing-title`         | boolean | title欠落ページ                |
| `--missing-description`   | boolean | description欠落ページ          |
| `--noindex`               | boolean | noindexページ                  |
| `--url-pattern`           | string  | SQL LIKEパターンでURL絞り込み  |
| `--directory`             | string  | ディレクトリprefixで絞り込み   |
| `--sort-by`               | string  | `url` / `status` / `title`     |
| `--sort-order`            | string  | `asc` / `desc`                 |
| `--limit`, `-l`           | number  | 最大取得件数                   |
| `--offset`, `-o`          | number  | スキップ件数                   |

`--content-type-category` は `html`、`pdf`、`csv`、`word`、`excel`、`powerpoint`、`image`、`css`、`javascript`、`json`、`xml`、`font`、`audio`、`video`、`archive`、`text`、`other`、`unknown` を指定できます。指定時は既定のHTML中心フィルタを外し、PDFなどの非HTMLページも対象になります。

### `page-detail`

```sh
npx @nitpicker/cli query ./site.nitpicker page-detail --url https://example.com/ --pretty
```

| オプション | 型               | 説明          |
| ---------- | ---------------- | ------------- |
| `--url`    | string, required | 対象ページURL |

### `html`

```sh
npx @nitpicker/cli query ./site.nitpicker html --url https://example.com/ --max-length 20000
```

| オプション     | 型               | 説明                 |
| -------------- | ---------------- | -------------------- |
| `--url`        | string, required | 対象ページURL        |
| `--max-length` | number           | 返すHTML文字数の上限 |

### `links`

```sh
npx @nitpicker/cli query ./site.nitpicker links --type broken --pretty
npx @nitpicker/cli query ./site.nitpicker links --type external --include-redirect-sources --pretty
```

| オプション                   | 型               | 説明                                                  |
| ---------------------------- | ---------------- | ----------------------------------------------------- |
| `--type`                     | string, required | `broken` / `external`                                 |
| `--include-redirect-sources` | boolean          | redirect-source行を含め、redirect解決前のリンクを見る |
| `--limit`, `-l`              | number           | 最大取得件数                                          |
| `--offset`, `-o`             | number           | スキップ件数                                          |

既定ではredirect先のcanonical destinationまで解決して判定します。`--include-redirect-sources` は診断用です。

### `resources`

```sh
npx @nitpicker/cli query ./site.nitpicker resources --content-type image/ --pretty
```

| オプション       | 型      | 説明                          |
| ---------------- | ------- | ----------------------------- |
| `--content-type` | string  | content type prefixで絞り込み |
| `--is-external`  | boolean | external/internalで絞り込み   |
| `--limit`, `-l`  | number  | 最大取得件数                  |
| `--offset`, `-o` | number  | スキップ件数                  |

### `images`

```sh
npx @nitpicker/cli query ./site.nitpicker images --missing-alt --pretty
```

| オプション              | 型      | 説明                          |
| ----------------------- | ------- | ----------------------------- |
| `--missing-alt`         | boolean | alt欠落画像                   |
| `--missing-dimensions`  | boolean | width/height欠落画像          |
| `--oversized-threshold` | number  | 指定寸法を超える画像          |
| `--url-pattern`         | string  | SQL LIKEパターンでURL絞り込み |
| `--limit`, `-l`         | number  | 最大取得件数                  |
| `--offset`, `-o`        | number  | スキップ件数                  |

### `violations`

```sh
npx @nitpicker/cli query ./site.nitpicker violations --validator axe --severity serious --pretty
```

| オプション       | 型     | 説明                  |
| ---------------- | ------ | --------------------- |
| `--validator`    | string | validator名で絞り込み |
| `--severity`     | string | severityで絞り込み    |
| `--rule`         | string | rule IDで絞り込み     |
| `--limit`, `-l`  | number | 最大取得件数          |
| `--offset`, `-o` | number | スキップ件数          |

### `duplicates`

```sh
npx @nitpicker/cli query ./site.nitpicker duplicates --field title --pretty
```

| オプション      | 型     | 説明                                      |
| --------------- | ------ | ----------------------------------------- |
| `--field`       | string | `title` / `description`。省略時は `title` |
| `--limit`, `-l` | number | 最大取得件数                              |

### `mismatches`

```sh
npx @nitpicker/cli query ./site.nitpicker mismatches --type canonical --pretty
```

| オプション       | 型               | 説明                                        |
| ---------------- | ---------------- | ------------------------------------------- |
| `--type`         | string, required | `canonical` / `og:title` / `og:description` |
| `--limit`, `-l`  | number           | 最大取得件数                                |
| `--offset`, `-o` | number           | スキップ件数                                |

### `headers`

```sh
npx @nitpicker/cli query ./site.nitpicker headers --missing-only --pretty
```

| オプション       | 型      | 説明                       |
| ---------------- | ------- | -------------------------- |
| `--missing-only` | boolean | 欠落があるページだけを表示 |
| `--limit`, `-l`  | number  | 最大取得件数               |
| `--offset`, `-o` | number  | スキップ件数               |

### `resource-referrers`

```sh
npx @nitpicker/cli query ./site.nitpicker resource-referrers --url https://example.com/app.css --pretty
```

| オプション | 型               | 説明            |
| ---------- | ---------------- | --------------- |
| `--url`    | string, required | 対象リソースURL |

### `error-kinds`

```sh
npx @nitpicker/cli query ./site.nitpicker error-kinds --pretty
```

追加オプションはありません。クロール失敗をhostとkind単位で集計します。

### `pages-by-tag` / `count-pages-by-tag`

```sh
npx @nitpicker/cli query ./site.nitpicker pages-by-tag --provider GoogleTagManager --pretty
npx @nitpicker/cli query ./site.nitpicker count-pages-by-tag --provider GoogleTagManager --external-id GTM-XXXX
```

| オプション       | 型               | 説明                          |
| ---------------- | ---------------- | ----------------------------- |
| `--provider`     | string, required | Wappalyzer provider名         |
| `--external-id`  | string           | GTM-XXXXなどの外部識別子      |
| `--limit`, `-l`  | number           | `pages-by-tag` の最大取得件数 |
| `--offset`, `-o` | number           | `pages-by-tag` のスキップ件数 |

### `pages-by-jsonld-type` / `count-pages-by-jsonld-type`

```sh
npx @nitpicker/cli query ./site.nitpicker pages-by-jsonld-type --type Article --pretty
npx @nitpicker/cli query ./site.nitpicker count-pages-by-jsonld-type --type Product
```

| オプション       | 型               | 説明                                  |
| ---------------- | ---------------- | ------------------------------------- |
| `--type`         | string, required | JSON-LD type                          |
| `--limit`, `-l`  | number           | `pages-by-jsonld-type` の最大取得件数 |
| `--offset`, `-o` | number           | `pages-by-jsonld-type` のスキップ件数 |

### `tag-inventory`

```sh
npx @nitpicker/cli query ./site.nitpicker tag-inventory --pretty
```

追加オプションはありません。

### `page-jsonld`

```sh
npx @nitpicker/cli query ./site.nitpicker page-jsonld --url https://example.com/ --pretty
npx @nitpicker/cli query ./site.nitpicker page-jsonld --url https://example.com/ --full --pretty
```

| オプション | 型               | 説明                                |
| ---------- | ---------------- | ----------------------------------- |
| `--url`    | string, required | 対象ページURL                       |
| `--full`   | boolean          | raw/parsedを含む完全なJSON-LDを返す |

### `page-jsonld-overview`

```sh
npx @nitpicker/cli query ./site.nitpicker page-jsonld-overview --url https://example.com/ --pretty
```

| オプション | 型               | 説明          |
| ---------- | ---------------- | ------------- |
| `--url`    | string, required | 対象ページURL |

### `page-tags`

```sh
npx @nitpicker/cli query ./site.nitpicker page-tags --url https://example.com/ --pretty
```

| オプション | 型               | 説明          |
| ---------- | ---------------- | ------------- |
| `--url`    | string, required | 対象ページURL |

### `isolated-pages`

```sh
npx @nitpicker/cli query ./site.nitpicker isolated-pages --pretty
```

| オプション       | 型     | 説明         |
| ---------------- | ------ | ------------ |
| `--limit`, `-l`  | number | 最大取得件数 |
| `--offset`, `-o` | number | スキップ件数 |

`crawl --inventory` で登録されたページのうち、通常クロール集合から孤立している単独ページを返します。

### `isolated-clusters`

```sh
npx @nitpicker/cli query ./site.nitpicker isolated-clusters --pretty
```

| オプション       | 型     | 説明         |
| ---------------- | ------ | ------------ |
| `--limit`, `-l`  | number | 最大取得件数 |
| `--offset`, `-o` | number | スキップ件数 |

`crawl --inventory` で登録されたページ同士でつながる、通常クロール集合から孤立したクラスタを返します。

### `get-isolated-cluster`

```sh
npx @nitpicker/cli query ./site.nitpicker get-isolated-cluster --representative-url https://example.com/orphan/ --pretty
```

| オプション             | 型               | 説明                              |
| ---------------------- | ---------------- | --------------------------------- |
| `--representative-url` | string, required | `isolated-clusters` で得た代表URL |

### `unused-resources`

```sh
npx @nitpicker/cli query ./site.nitpicker unused-resources --pretty
```

| オプション       | 型     | 説明         |
| ---------------- | ------ | ------------ |
| `--limit`, `-l`  | number | 最大取得件数 |
| `--offset`, `-o` | number | スキップ件数 |

`crawl --inventory` で登録されたリソースのうち、参照元ページがないものを返します。

### `inventory-runs`

```sh
npx @nitpicker/cli query ./site.nitpicker inventory-runs --pretty
```

| オプション       | 型     | 説明         |
| ---------------- | ------ | ------------ |
| `--limit`, `-l`  | number | 最大取得件数 |
| `--offset`, `-o` | number | スキップ件数 |

`crawl --inventory` の実行履歴を新しい順に返します。

### `console-logs`

```sh
npx @nitpicker/cli query ./site.nitpicker console-logs --type error --sort-by totalCount --sort-order desc --pretty
```

| オプション       | 型     | 説明                                                                   |
| ---------------- | ------ | ---------------------------------------------------------------------- |
| `--type`         | string | consoleメッセージのtypeで絞り込み（`error` / `warn` / `pageerror` 等） |
| `--sort-by`      | string | `totalCount` / `pageCount` / `text` / `type`。省略時は `totalCount`    |
| `--sort-order`   | string | `asc` / `desc`。省略時は `desc`                                        |
| `--limit`, `-l`  | number | 最大取得件数                                                           |
| `--offset`, `-o` | number | スキップ件数                                                           |

捕捉した console メッセージ・ページエラーを内容ごとに全ページ横断で集約して返します。同一内容が複数ページで発生していれば `pageCount`（発生ページ数）と `totalCount`（総出現数）で件数を確認できます。

### `page-console-logs`

```sh
npx @nitpicker/cli query ./site.nitpicker page-console-logs --url https://example.com/ --pretty
```

| オプション | 型               | 説明          |
| ---------- | ---------------- | ------------- |
| `--url`    | string, required | 対象ページURL |

指定ページで捕捉された console メッセージ・ページエラーを発生順に返します。`args`（引数）・発生箇所・スタックトレース（`pageerror` のみ）を含みます。

## 全オプション一覧

| オプション                   | 型      | 主な用途                                                                                                                   |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--limit`, `-l`              | number  | ページネーション                                                                                                           |
| `--offset`, `-o`             | number  | ページネーション                                                                                                           |
| `--url`                      | string  | `page-detail` / `html` / `resource-referrers` / `page-jsonld` / `page-jsonld-overview` / `page-tags` / `page-console-logs` |
| `--status`                   | number  | `pages`                                                                                                                    |
| `--status-min`               | number  | `pages`                                                                                                                    |
| `--status-max`               | number  | `pages`                                                                                                                    |
| `--is-external`              | boolean | `pages` / `resources`                                                                                                      |
| `--missing-title`            | boolean | `pages`                                                                                                                    |
| `--missing-description`      | boolean | `pages`                                                                                                                    |
| `--noindex`                  | boolean | `pages`                                                                                                                    |
| `--url-pattern`              | string  | `pages` / `images`                                                                                                         |
| `--directory`                | string  | `pages`                                                                                                                    |
| `--sort-by`                  | string  | `pages` / `console-logs`                                                                                                   |
| `--sort-order`               | string  | `pages` / `console-logs`                                                                                                   |
| `--type`                     | string  | `links` / `mismatches` / JSON-LD type系 / `console-logs`                                                                   |
| `--content-type`             | string  | `resources`                                                                                                                |
| `--content-type-category`    | string  | `pages`                                                                                                                    |
| `--missing-alt`              | boolean | `images`                                                                                                                   |
| `--missing-dimensions`       | boolean | `images`                                                                                                                   |
| `--oversized-threshold`      | number  | `images`                                                                                                                   |
| `--validator`                | string  | `violations`                                                                                                               |
| `--severity`                 | string  | `violations`                                                                                                               |
| `--rule`                     | string  | `violations`                                                                                                               |
| `--field`                    | string  | `duplicates`                                                                                                               |
| `--missing-only`             | boolean | `headers`                                                                                                                  |
| `--max-length`               | number  | `html`                                                                                                                     |
| `--provider`                 | string  | tag系                                                                                                                      |
| `--external-id`              | string  | tag系                                                                                                                      |
| `--full`                     | boolean | `page-jsonld`                                                                                                              |
| `--representative-url`       | string  | `get-isolated-cluster`                                                                                                     |
| `--include-redirect-sources` | boolean | `links`                                                                                                                    |
| `--pretty`                   | boolean | JSON整形                                                                                                                   |
