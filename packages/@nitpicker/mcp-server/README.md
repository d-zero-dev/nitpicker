# @nitpicker/mcp-server

`.nitpicker` アーカイブを Model Context Protocol (MCP) 経由で問い合わせるためのサーバーです。

内部では [@nitpicker/query](../query/README.md) を使い、AIアシスタントなどからアーカイブ内容を参照できるようにします。

## セットアップ

Claude Desktop の設定ファイルに以下を追加します。

```json
{
	"mcpServers": {
		"nitpicker": {
			"command": "npx",
			"args": ["@nitpicker/mcp-server"]
		}
	}
}
```

stdio トランスポートで起動し、`.nitpicker` アーカイブを開いてページ、リンク、リソース、分析結果などを問い合わせます。

`search_html` と `match_selector` は、クライアントがリクエストをキャンセルしたとき、または接続が切れたときに、走査を途中で止めます。

ネイティブ処理は、次の環境変数で調整できます。複数の呼び出しが並行したときは、上限を超えた分が順番に待ちます。正の整数でない値は、起動時にエラーにします。詳細は [@nitpicker/core](../core/README.md) を参照してください。

- `NITPICKER_NATIVE_THREADS`: スレッド数（既定は論理コア数）
- `NITPICKER_NATIVE_CONCURRENCY`: 同時に走らせる非同期のネイティブ呼び出しの数（既定は 1）

## 主なツール

| ツール                        | 説明                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| `open_archive`                | `.nitpicker` ファイルを開き、archiveIdを返す                      |
| `close_archive`               | アーカイブを閉じる                                                |
| `get_summary`                 | サイト全体の概要統計                                              |
| `list_pages`                  | ページ一覧                                                        |
| `get_page_detail`             | 指定ページの詳細                                                  |
| `list_inbound_links`          | 指定ページへの被リンク一覧                                        |
| `get_page_html`               | HTMLスナップショット                                              |
| `search_html`                 | 保存済みHTMLの文字列／正規表現検索（書き込みなし）                |
| `match_selector`              | 保存済みHTMLにCSSセレクタ一致要素を持つページを列挙（構造で探す） |
| `list_links`                  | リンク一覧（broken / external / 全件、URLパターンで絞り込み）     |
| `list_resources`              | リソース一覧（URLパターン・Content-Typeカテゴリで絞り込み）       |
| `list_pages_by_resource`      | 条件に一致するリソースを読み込むページ一覧（フォント利用など）    |
| `get_resource_host_inventory` | リソースのホスト別集計（サードパーティ依存の棚卸し）              |
| `list_images`                 | 画像一覧                                                          |
| `list_console_logs`           | 捕捉したconsoleログ・ページエラー（内容ごとに全ページ横断で集約） |

## 関連リンク

- [Nitpicker README](../../../README.md)
- [CLI query docs](../cli/docs/query.md)
- [ARCHITECTURE.md](../../../ARCHITECTURE.md)

## ライセンス

Apache-2.0
