# concat

複数の `.nitpicker` アーカイブを 1 つに結合し、新しいアーカイブを作成します。クロールは一切行いません。

## 基本形

```sh
npx @nitpicker/cli concat <archive1>.nitpicker <archive2>.nitpicker [<archive3>.nitpicker...] -o <output>
```

例:

```sh
npx @nitpicker/cli concat blog.nitpicker docs.nitpicker -o merged
npx @nitpicker/cli concat a.nitpicker b.nitpicker c.nitpicker -o merged --verbose
```

`-o/--output` は必須です。出力先が既に存在する場合はエラーになります（上書きしません）。

## 結合ルール

| 対象                                           | ルール                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `roots`                                        | 全ソースの和集合。引数の順で並び、重複は1つに                                                                           |
| 同一 URL が複数ソースにある場合                | 「最も情報量の多い観測」が勝つ：内部ページ(scraped済み) > 外部リンク(HEADのみ) > 未取得。同順位は後の引数のソースが勝つ |
| スコープ内だが未取得の外部URL                  | 昇格させず `is_external=1` のまま残す。件数と対処法（`crawl <out> --append <root>`）を完了後に表示                      |
| `disableQueries` / `fromList`                  | 全ソースで完全一致が必須。不一致はエラーで停止（設定が違うと URL の同一性判定が揃わないため）                           |
| その他の設定値                                 | 先頭のアーカイブの値を採用                                                                                              |
| `excludes` / `excludeKeywords` / `excludeUrls` | 全ソースの和集合                                                                                                        |

## 引き継がれるもの・引き継がれないもの

- 引き継ぐ: ページに紐づく分析結果（`analysis_violations`）、クロールエラー・ネットワーク断・dedupe-cap 等の履歴、`--inventory`/`--recrawl` の投入済み URL リスト、テンプレートの名前（`events テンプレート A` 等。再分類時の名前の継承元になる）
- 引き継がない: `analyze` プラグインが書き込む名前空間データ（例: `analysis/report`）。完了後にメッセージで再実行を案内します
- ページのテンプレート分類は結合後のアーカイブ全体で再実行されます（ソースごとのテンプレートキーは別々の分類結果由来で衝突しうるため、コピーではなく再導出します）。`--skip-templates` でスキップできます
- viewer read model は常に無条件で再構築されます

## 後続の作業

- 未取得の外部ページを取得したい: `npx @nitpicker/cli crawl <out> --append <root>`
- analyze の結果が必要: `npx @nitpicker/cli analyze <out>`
- テンプレート分類または read model の再構築に失敗した場合: `npx @nitpicker/cli viewer-build <out>`

## オプション一覧

| オプション         | 型            | 説明                                                               |
| ------------------ | ------------- | ------------------------------------------------------------------ |
| `-o, --output`     | string (必須) | 出力 `.nitpicker` パス。`.nitpicker` 拡張子は省略可                |
| `--skip-templates` | boolean       | 出力アーカイブでのテンプレート再分類をスキップ                     |
| `--verbose`        | boolean       | 各進捗行に ISO 8601 タイムスタンプを付けて追記出力（上書きしない） |

## 終了コード

| コード | 意味                                                                                  |
| ------ | ------------------------------------------------------------------------------------- |
| `0`    | 成功                                                                                  |
| `1`    | 引数検証エラー、または処理中の致命的エラー                                            |
| `2`    | 書き込みは完了したが、pending が非空、またはテンプレート分類・read model 再構築が失敗 |
