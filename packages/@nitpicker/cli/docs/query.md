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

| サブコマンド                 | 用途                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `summary`                    | アーカイブ全体の概要統計                                               |
| `pages`                      | ページ一覧                                                             |
| `page-detail`                | 指定URLのページ詳細                                                    |
| `inbound-links`              | 指定URLへの被リンク一覧（referrer単位、cursor/offsetページネーション） |
| `html`                       | 指定URLのHTMLスナップショット                                          |
| `links`                      | broken/externalリンク一覧                                              |
| `resources`                  | ネットワークリソース一覧                                               |
| `images`                     | 画像一覧と画像品質フィルタ                                             |
| `violations`                 | 分析プラグインの違反結果                                               |
| `duplicates`                 | title/descriptionの重複                                                |
| `duplicate-clusters`         | 同一body_hashクラスタの集約（trap兆候でソート）                        |
| `dedupe-cap-events`          | `--dedupe-cap` の同一クラスタ soft cap 発火履歴                        |
| `mismatches`                 | canonical/OGPメタデータの不一致                                        |
| `headers`                    | セキュリティヘッダー確認                                               |
| `resource-referrers`         | 指定リソースの参照元ページ                                             |
| `error-kinds`                | クロール失敗原因の集計                                                 |
| `pages-by-technology`        | 検出された技術スタックに一致するページ                                 |
| `count-pages-by-technology`  | 検出された技術スタックに一致するページ数                               |
| `pages-by-jsonld-type`       | JSON-LD typeに一致するページ                                           |
| `count-pages-by-jsonld-type` | JSON-LD typeに一致するページ数                                         |
| `technology-inventory`       | サイト全体の技術スタック検出一覧（技術別ページ数・平均確信度）         |
| `page-jsonld`                | 指定URLのJSON-LD                                                       |
| `page-jsonld-overview`       | 指定URLのJSON-LD概要                                                   |
| `page-technologies`          | 指定URLの検出技術スタック（星取り表、confidence・signals明細付き）     |
| `isolated-pages`             | inventory由来の完全孤立ページ                                          |
| `isolated-clusters`          | inventory由来の孤立クラスタ                                            |
| `get-isolated-cluster`       | 指定代表URLの孤立クラスタ詳細                                          |
| `unused-resources`           | 参照元がないinventory由来リソース                                      |
| `list-reconcile-runs`        | `--inventory`/`--recrawl` の取り込み実行履歴                           |
| `console-logs`               | 捕捉したconsoleログ・ページエラー（内容ごとに全ページ横断で集約）      |
| `page-console-logs`          | 指定URLのconsoleログ・ページエラー明細                                 |
| `match-urls`                 | URLリストとアーカイブの突合診断（`report --urls` の未マッチ調査用）    |
| `match-selector`             | 保存済みHTMLにCSSセレクタに一致する要素を持つページを列挙              |

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
| `--directory`             | string  | ディレクトリで絞り込み（下記） |
| `--sort-by`               | string  | `url` / `status` / `title`     |
| `--sort-order`            | string  | `asc` / `desc`                 |
| `--limit`, `-l`           | number  | 最大取得件数                   |
| `--offset`, `-o`          | number  | スキップ件数                   |

`--content-type-category` は `html`、`pdf`、`csv`、`word`、`excel`、`powerpoint`、`image`、`css`、`javascript`、`json`、`xml`、`font`、`audio`、`video`、`archive`、`text`、`other`、`unknown` を指定できます。指定時は既定のHTML中心フィルタを外し、PDFなどの非HTMLページも対象になります。

`--directory` はそのディレクトリのページ自身と配下すべてに一致します（`search-html` / `match-selector` も同じ意味、`report --html-dirs` とも同じ）。境界は `/` 区切りで、`/blog` は `/blog`・`/blog/`・`/blog?page=2`・`/blog/2024/post` に一致し、`/blogging` や `/en/blog/post` には一致しません。パスだけ（`/blog`）なら全ホストが対象で、`https://example.com/blog` のようにURLで書くとそのホストに限定します（スキームとポートは比較しません）。スキームのない `example.com/blog` はホストではなくパス `/example.com/blog` として扱います。パスはURLに保存されている形（パーセントエンコード済み）と大文字小文字を区別して比較し、`%` や `_` はワイルドカードではなく文字そのものとして扱います。空白だけの値やHTTP(S)以外のURLは、アーカイブを開く前にエラー（exit code 1）になります。

### `page-detail`

```sh
npx @nitpicker/cli query ./site.nitpicker page-detail --url https://example.com/ --pretty
```

| オプション | 型               | 説明          |
| ---------- | ---------------- | ------------- |
| `--url`    | string, required | 対象ページURL |

### `inbound-links`

```sh
npx @nitpicker/cli query ./site.nitpicker inbound-links --url https://example.com/ --pretty
npx @nitpicker/cli query ./site.nitpicker inbound-links --url https://example.com/ --limit 100 --cursor <前回のnextCursor>
```

| オプション       | 型               | 説明                                        |
| ---------------- | ---------------- | ------------------------------------------- |
| `--url`          | string, required | 対象ページURL                               |
| `--limit`, `-l`  | number           | 最大取得件数。`0` で件数（`total`）のみ取得 |
| `--offset`, `-o` | number           | スキップ件数（ページ番号ジャンプ用）        |
| `--cursor`       | string           | 前回の結果の `nextCursor`/`prevCursor`      |
| `--direction`    | string           | `--cursor` と併用。`next`（既定）/ `prev`   |

`viewer_anchor_facts` read model のみを読みます。read model が未構築・古い場合は `viewer-build` の実行を促すエラーで失敗します（フォールバックなし）。

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
npx @nitpicker/cli query ./site.nitpicker links --dest-url-pattern '%.pdf' --pretty
```

| オプション                   | 型      | 説明                                                                                  |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `--type`                     | string  | `broken` / `external` / `all`（既定 `all`）                                           |
| `--url-pattern`              | string  | SQL LIKEパターン。リンク元またはリンク先URLに一致                                     |
| `--source-url-pattern`       | string  | SQL LIKEパターン。リンク元ページURLだけに一致                                         |
| `--dest-url-pattern`         | string  | SQL LIKEパターン。redirect解決後のリンク先URLだけに一致                               |
| `--status`                   | number  | リンク先のHTTP statusで完全一致                                                       |
| `--sort-by`                  | string  | `sourceUrl` / `destUrl` / `status` / `isExternal` / `textContent`（既定 `sourceUrl`） |
| `--sort-order`               | string  | `asc` / `desc`                                                                        |
| `--include-redirect-sources` | boolean | redirect-source行を含め、redirect解決前のリンクを見る                                 |
| `--limit`, `-l`              | number  | 最大取得件数                                                                          |
| `--offset`, `-o`             | number  | スキップ件数                                                                          |

既定ではredirect先のcanonical destinationまで解決して判定します。`--include-redirect-sources` は診断用です。

### `resources`

```sh
npx @nitpicker/cli query ./site.nitpicker resources --content-type image/ --pretty
npx @nitpicker/cli query ./site.nitpicker resources --content-type-category font --sort-by referrerCount --sort-order desc --pretty
```

| オプション                | 型      | 説明                                                                                                                    |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--url-pattern`           | string  | SQL LIKEパターンでリソースURLを絞り込み                                                                                 |
| `--status`                | number  | HTTP statusで完全一致                                                                                                   |
| `--content-type`          | string  | content type prefixで絞り込み                                                                                           |
| `--content-type-category` | string  | Content-Typeカテゴリで絞り込み（`font` / `css` / `javascript` / `image` など。`pages` と同じ分類）                      |
| `--is-external`           | boolean | external/internalで絞り込み                                                                                             |
| `--sort-by`               | string  | `url` / `status` / `statusText` / `contentType` / `contentLength` / `isExternal` / `referrerCount` / `compress` / `cdn` |
| `--sort-order`            | string  | `asc` / `desc`                                                                                                          |
| `--limit`, `-l`           | number  | 最大取得件数                                                                                                            |
| `--offset`, `-o`          | number  | スキップ件数                                                                                                            |

アーカイブに保存されるのはリソースのメタデータ（URL・Content-Type・status・サイズ等）だけで、CSS/JS/フォントの本文は保存されません。「フォントを使っているか」は、ブラウザが実際に取得したフォントファイルの有無（`--content-type-category font`）で判定します。

### `pages-by-resource`

```sh
npx @nitpicker/cli query ./site.nitpicker pages-by-resource --content-type-category font --pretty
npx @nitpicker/cli query ./site.nitpicker pages-by-resource --url-pattern '%fonts.example.net%' --resources-limit 5 --pretty
```

| オプション                | 型      | 説明                                                                                 |
| ------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `--url-pattern`           | string  | SQL LIKEパターンでリソースURLを絞り込み（※`--content-type-category` とどちらか必須） |
| `--content-type-category` | string  | Content-Typeカテゴリで絞り込み（※`--url-pattern` とどちらか必須）                    |
| `--is-external`           | boolean | external/internalのリソースに限定                                                    |
| `--status`                | number  | リソースのHTTP statusで完全一致                                                      |
| `--resources-limit`       | number  | ページごとに添える一致リソースURLのサンプル数（既定 20）                             |
| `--limit`, `-l`           | number  | 最大取得件数                                                                         |
| `--offset`, `-o`          | number  | スキップ件数                                                                         |

条件に一致するリソースを読み込んでいるページを返す、`resources` の逆引きです。各ページに `matchedResourceCount` と一致リソースURLのサンプル（`matchedResources`）が付きます。完全一致のリソースURLから引く場合は `resource-referrers` を使います。

### `resource-hosts`

```sh
npx @nitpicker/cli query ./site.nitpicker resource-hosts --is-external --sort-by pageCount --pretty
```

| オプション       | 型      | 説明                                                |
| ---------------- | ------- | --------------------------------------------------- |
| `--is-external`  | boolean | external/internalのリソースに限定                   |
| `--sort-by`      | string  | `resourceCount`（既定・降順）/ `pageCount` / `host` |
| `--sort-order`   | string  | `asc` / `desc`                                      |
| `--limit`, `-l`  | number  | 最大取得件数                                        |
| `--offset`, `-o` | number  | スキップ件数                                        |

リソースをホスト（host + port）単位で集計し、リソース数・参照ページ数・Content-Typeカテゴリ内訳（`categories`）を返します。サードパーティ依存の棚卸し用です。`data:` URIのリソースはホストを持たないため含みません。

### `search-html`

```sh
npx @nitpicker/cli query ./site.nitpicker search-html --pattern 'fonts.example.org' --pretty
npx @nitpicker/cli query ./site.nitpicker search-html --pattern '/font-family\s*:\s*"?Sample/i' --directory /blog --limit 0
```

| オプション         | 型               | 説明                                                                              |
| ------------------ | ---------------- | --------------------------------------------------------------------------------- |
| `--pattern`        | string, required | 通常の文字列はリテラル部分一致、`/pattern/flags`（flagsは `g` `i` `m`）は正規表現 |
| `--url-pattern`    | string           | SQL LIKEパターンでスキャン対象ページを絞り込み                                    |
| `--directory`      | string           | ディレクトリでスキャン対象ページを絞り込み（`pages` の `--directory` と同じ意味） |
| `--snippet-length` | number           | スニペットの文字数（既定 160）                                                    |
| `--limit`, `-l`    | number           | 最大取得件数（既定 100）。`0` で件数（`total`）のみ                               |
| `--offset`, `-o`   | number           | スキップ件数                                                                      |

保存済みのHTMLスナップショット（`html` サブコマンドが返すもの）の生マークアップを検索します。analyzeプラグインの実行は不要で、アーカイブへの書き込みもありません。`<script>` `<style>` やインラインstyle・全属性も対象です（DOMのテキストノードだけを見る `analyze-search` とは別物）。

結果は `{ items: [{ url, matchCount, snippet }], total, offset, limit, scannedSnapshots, candidatePages }` です。全ユニークHTMLを展開する線形スキャンなので、大きなアーカイブでは時間がかかります（stderrに進捗が出ます）。まず `--limit 0` で `total` を確認するのが安全です。`candidatePages` が0、またはページ数より極端に少ない場合はHTMLが保存されておらず、`total: 0` は「該当なし」を意味しません。CSS/JSファイルの本文は保存されていないため検索できません。

### `match-selector`

```sh
npx @nitpicker/cli query ./site.nitpicker match-selector --selector 'nav > a[href^="/products/"]' --pretty
npx @nitpicker/cli query ./site.nitpicker match-selector --selector 'img:not([alt]), a[target="_blank"]:not([rel~="noopener"])' --limit 0
npx @nitpicker/cli query ./site.nitpicker match-selector --selector 'table:not([class])' --directory /news --limit 0
```

| オプション       | 型               | 説明                                                                              |
| ---------------- | ---------------- | --------------------------------------------------------------------------------- |
| `--selector`     | string, required | CSSセレクタ（カンマ区切りリスト可。対応文法は下記）                               |
| `--url-pattern`  | string           | SQL LIKEパターンでスキャン対象ページを絞り込み                                    |
| `--directory`    | string           | ディレクトリでスキャン対象ページを絞り込み（`pages` の `--directory` と同じ意味） |
| `--limit`, `-l`  | number           | 最大取得件数（既定 100）。`0` で件数（`total`）のみ                               |
| `--offset`, `-o` | number           | スキップ件数                                                                      |

保存済みのHTMLスナップショットに、セレクタに一致する要素を1つ以上持つページを返します。ページ単位の存在判定で、一致要素の位置や個数は返しません。analyzeプラグインの実行は不要で、アーカイブへの書き込みもありません（`analyze-search` はjsdomで全ページのDOMを構築しますが、本コマンドはDOMを作りません）。

**対応するセレクタ**: 複合セレクタ（`*` / タグ / `.class` / `#id` / `[attr]` `[attr=v]` `[attr~=v]` `[attr|=v]` `[attr^=v]` `[attr$=v]` `[attr*=v]`、`i` / `s` フラグ付き）、子孫結合子（`a b`）、子結合子（`a > b`）、`:first-child` `:nth-child(An+B)` `:first-of-type` `:nth-of-type(An+B)`、`:not(複合セレクタ)`、カンマ区切りリスト。

**対応しないセレクタ**: 要素より後ろのマークアップが分からないと判定できないもの（`+` `~` 結合子、`:last-child` `:only-child` `:nth-last-*` `:has()`）、`:is()` `:where()`、`:root` `:empty` などの状態系疑似クラス、疑似要素、名前空間、`:nth-child()` の `of S`、`:not()` に渡すリスト・結合子・入れ子の `:not()`。これらは近似せず、対応文法の一覧つきのエラー（exit code 1）で拒否します。

結果は `{ selector, items: [{ pageId, url }], total, offset, limit, scannedSnapshots, candidatePages, prefilteredSnapshots, tokenizedSnapshots, matchedSnapshots }` です。`items` は `pageId` 順です。全ユニークHTMLを展開する線形スキャンで、同一HTMLは1回だけ判定してページへ展開します。走査対象は `search-html` と同じ（HTMLスナップショットを持つ、skipされていないページ。`--url-pattern` / `--directory` の絞り込みも同じ意味）で、絞り込むと `candidatePages` / `scannedSnapshots` / `total` は絞り込み後のページだけを数えます。絞り込みなしで `candidatePages` が0またはページ数より極端に少なければHTMLが保存されておらず、`total: 0` は「該当なし」を意味しません。stderrに進捗が出ます。

`prefilteredSnapshots` と `tokenizedSnapshots` は判定の経路を示します。どのセレクタも、まず必要なリテラルが順に現れるかを `indexOf` で確認し、現れない文書はマークアップを一度も走査せずに却下します（`prefilteredSnapshots`）。残りのうち、1つの開始タグだけで決まるセレクタ（`img[alt]` `.nav` など）は正規表現1本で判定します。結合子・`:nth-*`・`<` `>` を含む属性値のセレクタと、`<template` を含む文書は開タグスタックで評価し、`tokenizedSnapshots` に数えます。

MCPツール `match_selector` も同じ関数を呼び、同じ結果を返します（`selector` / `url-pattern` / `directory` / `limit` / `offset` に相当する引数を取ります）。非対応のセレクタは対応文法の一覧つきのエラー（`isError`）で拒否されます。

**判定の契約**: 結果は「保存文字列を次の規則で解釈した木」に対する判定で、元のDOMとの一致は保証しません（直列化は単射ではなく、たとえば `script` のテキストが `</script><img><script>` のDOMと、空の `script`・`img`・空の `script` が並ぶDOMは同じ文字列になります）。

1. `<!--` から最初の `-->` まで、`<![CDATA[` から最初の `]]>` まで、`<!` から最初の `>` まではタグではない
2. `script` `style` `xmp` `iframe` `noembed` `noframes` `plaintext` `noscript` は、開始タグだけを要素として判定し、`</名前` に続く空白・`/`・`>` までの内容はタグではない（終了タグが無ければ文書末尾まで。`plaintext` は常に末尾まで）。名前だけで判定し、`svg` 内などの名前空間は見ない。`noscript` はスクリプト有効で直列化されるため、中身はテキストとして扱う
3. それ以外の開始タグ・終了タグを対応づけて木を作る。HTML5の暗黙閉じ規則は適用しない（`<p><div></div></p>` は `p > div` に一致する）。void要素と `/>` は子を持たない。スタック先頭と名前が違う終了タグは無視し、閉じられていない要素は書かれたとおり開いたままにする（`<div><b></div><p>` では `p` は `b` の子になる）。引用符つき属性値の中の `<` はタグの始まりではない
4. `<template>` の子孫は探索しない（`querySelectorAll` が到達しないため）。`template` 要素自身は判定対象
5. 属性値は `&amp;` `&lt;` `&gt;` `&quot;` `&nbsp;` だけを復号する。タグ名と属性名は大文字小文字を区別しない（DOMはHTML要素だけを区別しない扱いにするので、SVGの `linearGradient` は `lineargradient` でも一致する。DOMより広く一致する側に倒している）。属性値は `i` フラグがなければ区別するが、HTMLが区別しないと定める属性（`type` `rel` `lang` `target` `method` など）は `s` フラグがない限り区別しない。`~=` の区切りはASCII空白のみ。この規則は直列化出力の形（属性値は二重引用符、重複属性なし、`<br>` のように閉じる `/` を属性に書かない）を前提にし、それ以外の形では正規表現とスタックの結果が食い違いうる

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

### `pages-by-technology` / `count-pages-by-technology`

```sh
npx @nitpicker/cli query ./site.nitpicker pages-by-technology --technology "Next.js" --pretty
npx @nitpicker/cli query ./site.nitpicker count-pages-by-technology --technology "Next.js" --min-confidence 50
```

| オプション         | 型               | 説明                                                                                                                                                 |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--technology`     | string, required | 技術名（例: `Next.js`, `Google Tag Manager`）                                                                                                        |
| `--min-confidence` | number           | `page_technologies.confidence` の下限（0-100）                                                                                                       |
| `--signal-type`    | string           | 検出シグナル種別で絞り込み（`wappalyzer` / `meta-generator` / `html-marker` / `url-pattern` / `scoped-attr` / `weak-marker` / `js-license-comment`） |
| `--limit`, `-l`    | number           | `pages-by-technology` の最大取得件数                                                                                                                 |
| `--offset`, `-o`   | number           | `pages-by-technology` のスキップ件数                                                                                                                 |

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

### `technology-inventory`

```sh
npx @nitpicker/cli query ./site.nitpicker technology-inventory --pretty
```

追加オプションはありません。サイト全体で検出された技術ごとにページ数と平均確信度を返します。

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

### `page-technologies`

```sh
npx @nitpicker/cli query ./site.nitpicker page-technologies --url https://example.com/ --pretty
```

| オプション | 型               | 説明          |
| ---------- | ---------------- | ------------- |
| `--url`    | string, required | 対象ページURL |

指定URLで検出された全技術をconfidence降順で返します（各技術のcategory/version、検出に使われた全signals明細を含む「星取り表」）。

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

### `list-reconcile-runs`

```sh
npx @nitpicker/cli query ./site.nitpicker list-reconcile-runs --pretty
```

| オプション       | 型     | 説明         |
| ---------------- | ------ | ------------ |
| `--limit`, `-l`  | number | 最大取得件数 |
| `--offset`, `-o` | number | スキップ件数 |

`crawl --inventory` / `crawl --recrawl` の実行履歴を新しい順に返します。両方とも同じ `list_reconcile_runs` テーブルに記録され、`list_label` の `inventory-`/`recrawl-` prefix で由来を区別できます。

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

### `match-urls`

```sh
npx @nitpicker/cli query ./site.nitpicker match-urls --urls ./urls.txt --pretty
```

| オプション | 型               | 説明                                             |
| ---------- | ---------------- | ------------------------------------------------ |
| `--urls`   | string, required | 1行1URLのリストファイル（空行・`#`コメント許容） |

リスト内の各URLについて、アーカイブに存在するか（`found`）・redirect先・external/skip判定・ステータス等を入力順のまま返します。`results`（URLごとの詳細）・`invalidLines`（URL形式として無効だった行）・`summary`（`total`/`invalid`/`found`/`notFound`件数）を含みます。`report -H --urls` / `report -S --urls` がレポートに載せなかったURLの理由（未収録・redirect化・PDF等の対象外カテゴリ）を突き止める診断用コマンドです。

## 全オプション一覧

| オプション                   | 型      | 主な用途                                                                                                                                             |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--limit`, `-l`              | number  | ページネーション                                                                                                                                     |
| `--offset`, `-o`             | number  | ページネーション                                                                                                                                     |
| `--cursor`                   | string  | `resource-referrers` / `duplicates` / `mismatches` / `inbound-links`                                                                                 |
| `--direction`                | string  | `duplicates` / `mismatches` / `inbound-links`（`--cursor` と併用）                                                                                   |
| `--url`                      | string  | `page-detail` / `inbound-links` / `html` / `resource-referrers` / `page-jsonld` / `page-jsonld-overview` / `page-technologies` / `page-console-logs` |
| `--status`                   | number  | `pages`                                                                                                                                              |
| `--status-min`               | number  | `pages`                                                                                                                                              |
| `--status-max`               | number  | `pages`                                                                                                                                              |
| `--is-external`              | boolean | `pages` / `resources`                                                                                                                                |
| `--missing-title`            | boolean | `pages`                                                                                                                                              |
| `--missing-description`      | boolean | `pages`                                                                                                                                              |
| `--noindex`                  | boolean | `pages`                                                                                                                                              |
| `--url-pattern`              | string  | `pages` / `images` / `search-html` / `match-selector`                                                                                                |
| `--directory`                | string  | `pages` / `search-html` / `match-selector`                                                                                                           |
| `--sort-by`                  | string  | `pages` / `console-logs`                                                                                                                             |
| `--sort-order`               | string  | `pages` / `console-logs`                                                                                                                             |
| `--type`                     | string  | `links` / `mismatches` / JSON-LD type系 / `console-logs`                                                                                             |
| `--content-type`             | string  | `resources`                                                                                                                                          |
| `--content-type-category`    | string  | `pages`                                                                                                                                              |
| `--missing-alt`              | boolean | `images`                                                                                                                                             |
| `--missing-dimensions`       | boolean | `images`                                                                                                                                             |
| `--oversized-threshold`      | number  | `images`                                                                                                                                             |
| `--validator`                | string  | `violations`                                                                                                                                         |
| `--severity`                 | string  | `violations`                                                                                                                                         |
| `--rule`                     | string  | `violations`                                                                                                                                         |
| `--field`                    | string  | `duplicates`                                                                                                                                         |
| `--missing-only`             | boolean | `headers`                                                                                                                                            |
| `--max-length`               | number  | `html`                                                                                                                                               |
| `--technology`               | string  | 技術スタック系                                                                                                                                       |
| `--min-confidence`           | number  | 技術スタック系                                                                                                                                       |
| `--signal-type`              | string  | 技術スタック系                                                                                                                                       |
| `--full`                     | boolean | `page-jsonld`                                                                                                                                        |
| `--representative-url`       | string  | `get-isolated-cluster`                                                                                                                               |
| `--include-redirect-sources` | boolean | `links`                                                                                                                                              |
| `--urls`                     | string  | `match-urls`                                                                                                                                         |
| `--selector`                 | string  | `match-selector`                                                                                                                                     |
| `--pretty`                   | boolean | JSON整形                                                                                                                                             |
