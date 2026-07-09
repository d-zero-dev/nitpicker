# @nitpicker/core

`.nitpicker` アーカイブ内のページに対して analyze プラグインを実行する内部パッケージです。

プラグインの読み込み、実行、結果の書き戻しを担当します。通常は [@nitpicker/cli](../cli/README.md) の `analyze` コマンドから利用します。

## プラグイン作者向けAPI

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
		// 重いプラグインは小さく設定する
		concurrency: 4,
		headers: {
			found: 'Keywords Found',
		},
		async eachPage({ window }) {
			const text = window.document.body.textContent ?? '';
			const count = options.keywords.filter((keyword) => text.includes(keyword)).length;
			return {
				page: { found: { value: count } },
			};
		},
	};
});
```

`concurrency` を省略するとCPUコア数が使われます。ChromeやPuppeteerなど重いプロセスを起動するプラグインでは、2〜4程度に絞ることを推奨します。

## 関連リンク

- [Nitpicker README](../../../README.md)
- [CLI analyze docs](../cli/docs/analyze.md)
- [CONTRIBUTING.md](../../../CONTRIBUTING.md)
- [ARCHITECTURE.md](../../../ARCHITECTURE.md)

## ライセンス

Apache-2.0
