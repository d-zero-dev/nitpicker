import { describe, expect, it } from 'vitest';

import { getGraphQueryParams } from './get-graph-query-params.js';

describe('getGraphQueryParams', () => {
	it('?limit= が無ければ limit は undefined', () => {
		expect(getGraphQueryParams(new URLSearchParams(''))).toEqual({ limit: undefined });
	});

	it('?limit=0 は文字列 "0" として通過 (API 側で uncapped 扱い)', () => {
		expect(getGraphQueryParams(new URLSearchParams('limit=0'))).toEqual({ limit: '0' });
	});

	it('?limit=50000 は文字列 "50000" として通過', () => {
		expect(getGraphQueryParams(new URLSearchParams('limit=50000'))).toEqual({
			limit: '50000',
		});
	});

	it('?limit= (空文字列) は空文字列として通過 (undefined ではない — API 側で fallback)', () => {
		// 空文字列を undefined に落とすと apiGet が param 省略するので "指定なし" と区別できなくなる。
		// URLSearchParams.get('') は '' を返すのでその通過を守る。
		expect(getGraphQueryParams(new URLSearchParams('limit='))).toEqual({ limit: '' });
	});

	it('他の query param があっても limit だけを返す', () => {
		expect(getGraphQueryParams(new URLSearchParams('foo=bar&limit=100&baz=qux'))).toEqual(
			{
				limit: '100',
			},
		);
	});
});
