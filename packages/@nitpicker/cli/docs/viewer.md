# viewer

`.nitpicker` アーカイブまたはクロール中断時のstubディレクトリをローカルビューアで開きます。

## 基本形

```sh
npx @nitpicker/cli viewer <archive-or-stub-dir> [options]
```

例:

```sh
npx @nitpicker/cli viewer ./site.nitpicker
npx @nitpicker/cli viewer ./stub-dir --port 4324
```

## オプション一覧

| オプション             | 型      | 説明                                                                        |
| ---------------------- | ------- | --------------------------------------------------------------------------- |
| `--port`, `-p`         | number  | 待ち受けポート。既定は `4324`。利用できない場合は空きポートへフォールバック |
| `--host`               | string  | バインドするホスト名。既定は `localhost`                                    |
| `--open` / `--no-open` | boolean | 既定ブラウザを自動で開くか。既定は有効                                      |
