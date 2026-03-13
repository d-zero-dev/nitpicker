# @nitpicker/mcp-server

`.nitpicker` アーカイブファイルを AI アシスタントから操作するための MCP サーバー。

## 概要

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) を介して、`.nitpicker` アーカイブの内容を AI アシスタント（Claude Desktop 等）から直接クエリできるサーバーです。stdio トランスポートで動作し、14 のツールを提供します。

内部では `@nitpicker/query` パッケージのクエリ関数を呼び出しています。

### 提供ツール

| ツール                   | 説明                                                 |
| ------------------------ | ---------------------------------------------------- |
| `open_archive`           | `.nitpicker` ファイルを読み込み、archiveId を返す    |
| `close_archive`          | アーカイブを閉じてリソースを解放                     |
| `get_summary`            | サイト全体の概要統計                                 |
| `list_pages`             | ページ一覧（フィルタ・ソート・ページネーション対応） |
| `get_page_detail`        | 特定ページの詳細情報                                 |
| `get_page_html`          | HTML スナップショットの取得                          |
| `list_links`             | リンク分析（壊れたリンク、外部リンク、孤立ページ）   |
| `list_resources`         | サブリソース一覧（CSS、JS、画像、フォント）          |
| `list_images`            | 画像品質チェック（alt 欠落、サイズ欠落、過大画像）   |
| `get_violations`         | 分析プラグインの違反結果                             |
| `find_duplicates`        | メタデータ重複検出                                   |
| `find_mismatches`        | メタデータ不一致検出                                 |
| `get_resource_referrers` | リソース参照元ページの検出                           |
| `check_headers`          | セキュリティヘッダー確認                             |

## セットアップ

Claude Desktop の設定ファイルに以下を追加してください。

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

このパッケージは [Nitpicker](../../README.md) モノレポの内部パッケージです。

## ライセンス

Apache-2.0
