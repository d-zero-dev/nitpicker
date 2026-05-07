# @nitpicker/core

プラグインベースのページ分析エンジン。

## 概要

`.nitpicker` アーカイブ内の各ページに対して、analyze プラグインを並列実行するためのエンジンです。プラグインの検出・読み込み・Worker スレッドプールでの実行を担当します。

このパッケージは [Nitpicker](../../README.md) モノレポの内部パッケージです。単体での利用は想定していません。

## プラグイン作者向け

analyze プラグインは `definePlugin()` で定義します。

```ts
import { definePlugin } from '@nitpicker/core';

type Options = {
	keywords: string[];
};

export default definePlugin((options: Options) => {
	return {
		label: 'キーワード検索',
		// 並列度を宣言できる。省略時は os.cpus().length
		// 重いプラグイン（Chrome 起動など）は小さく設定する
		concurrency: 4,
		headers: {
			found: 'Keywords Found',
		},
		async eachPage({ window }) {
			const text = window.document.body.textContent ?? '';
			const count = options.keywords.filter((k) => text.includes(k)).length;
			return {
				page: { found: { value: count } },
			};
		},
	};
});
```

### `concurrency` の指針

- **省略**: `os.cpus().length`（CPU コア数）が使われる。軽量な DOM 解析のみのプラグインはこのままで良い
- **小さく設定すべきケース**: Chrome や Puppeteer などの重いプロセスを起動するプラグインは 2〜4 程度に絞る。例えば `@nitpicker/analyze-lighthouse` は Chrome 1 プロセス ≒ 300〜500MB を消費するため `concurrency: 2`

詳細は [CONTRIBUTING.md](../../../CONTRIBUTING.md) と [ARCHITECTURE.md](../../../ARCHITECTURE.md) を参照。

## ライセンス

Apache-2.0
