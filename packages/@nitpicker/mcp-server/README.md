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

## 主なツール

| ツール            | 説明                                         |
| ----------------- | -------------------------------------------- |
| `open_archive`    | `.nitpicker` ファイルを開き、archiveIdを返す |
| `close_archive`   | アーカイブを閉じる                           |
| `get_summary`     | サイト全体の概要統計                         |
| `list_pages`      | ページ一覧                                   |
| `get_page_detail` | 指定ページの詳細                             |
| `get_page_html`   | HTMLスナップショット                         |
| `list_links`      | リンク一覧                                   |
| `list_resources`  | リソース一覧                                 |
| `list_images`     | 画像一覧                                     |
| `get_violations`  | 分析プラグインの違反結果                     |

## 関連リンク

- [Nitpicker README](../../../README.md)
- [CLI query docs](../cli/docs/query.md)
- [ARCHITECTURE.md](../../../ARCHITECTURE.md)

## ライセンス

Apache-2.0
