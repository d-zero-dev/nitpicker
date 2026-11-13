# @nitpicker/viewer

`.nitpicker`アーカイブまたはクロール中断時のstubディレクトリを閲覧するローカルビューアです。

通常は[@nitpicker/cli](../cli/README.md)の`viewer`コマンドから起動します。

## 対応ブラウザ

ボタン操作に[Invoker Commands API](https://developer.mozilla.org/ja/docs/Web/API/Invoker_Commands_API)（`<button command commandfor>`）を、列フィルタの位置決めにCSS Anchor Positioningを使うため、次のバージョン以降のブラウザが必要です（Invoker CommandsはChrome/Edge 135・Firefox 144・Safari 26.2、Anchor PositioningはChrome/Edge 125・Firefox 147・Safari 26）。ポリフィルは入れていません。未対応のブラウザではボタンが反応しません（検出や警告の表示もありません）。

- Chrome/Edge 135
- Firefox 147
- Safari 26.2

`nitpicker report -H`が出力する静的HTMLレポートも同じ API でテーマ切替ボタンを動かします。未対応のブラウザでもレポートの内容は読めますが、テーマ切替ボタンだけが反応しません（初期テーマはOSの設定に従います）。

## 開発

`web/components/*`の汎用UIコンポーネントは Storybook 駆動で確認・改善できます（`web/routes/*`の画面は対象外）。

```sh
yarn workspace @nitpicker/viewer storybook
```

## 関連リンク

- [Nitpicker README](../../../README.md)
- [CLI viewer docs](../cli/docs/viewer.md)

## ライセンス

Apache-2.0
