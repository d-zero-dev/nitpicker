# @nitpicker/report-html

Generates a self-contained HTML report from a completed Nitpicker archive.
The document contains the viewer summary and a bounded internal-page table,
requires no Google credentials, and can be opened directly with `file://`.

Use the CLI for interactive directory selection:

```sh
yarn cli report ./site.nitpicker --html
```

The package API is also available:

```ts
import { report } from '@nitpicker/report-html';

await report({ filePath: './site.nitpicker' });
```
