---
name: major-rotation
description: 系列の移行（次メジャーの開始、次メジャーの正式版化、旧系列の終了）。系列定義・Renovate・CI・SECURITY.md・文書・GitHub の設定をまとめて切り替える
when_to_use: 系列移行の Issue（rotation・end of support）を渡されたとき、またはユーザーが次メジャーの開始を指示したとき
disable-model-invocation: true
---

系列の正は`.github/release-lines.json`。この手順は、まずファイルを変え、`release-automation lines-check`が指す食い違いを直していく。

リポジトリ外への書き込み（ブランチの作成・ロック、Ruleset、Environment、dist-tag、Issue の Close）は、対象と内容を示してユーザーの承認を得てから行う。

# 1. どの移行かを決める

| 契機                                                      | 移行                    |
| --------------------------------------------------------- | ----------------------- |
| ユーザーが次メジャーの開始を指示した                      | A. 次メジャーの開始     |
| ユーザーが次メジャーの正式版化を指示した                  | B. 次メジャーの正式版化 |
| rotation Issue（`Rotate the release lines after vX.0.0`） | C. 正式版の公開後の整理 |
| end of support Issue（`End of support for vN on ...`）    | D. 旧系列の終了         |

1つずつ確認する：対象のメジャー番号、移行の種類。

# 2. 移行ごとの変更

## A. 次メジャーの開始

前提：`dev`が正式版（`release-automation classify`で現行系列が`[stable]`）。プレリリース中なら始められないことをユーザーに伝えて止まる。

1. `dev`の先頭から`v<次>`ブランチを作る
2. 系列定義に`{ "branch": "v<次>", "role": "next" }`を足す
3. 手順3の一覧を直す
4. `v<次>`に Ruleset を作る（`/repo-setup`の references/rulesets.md の「次メジャー系列・旧系列のブランチ」）
5. 最初の Release PR は`v<次>`の`package.json`／`lerna.json`を`<次>.0.0-alpha.0`にした PR の後、手動起動で作る

## B. 次メジャーの正式版化

前提：`v<次>`が rc まで進んでいる。

1. 現行の最新の正式版タグから`v<現行>`ブランチを作る：`git push origin v<現行の最新タグ>^{commit}:refs/heads/v<現行>`
2. 系列定義を変える：`dev`は現行のまま、`v<現行>`を`previous`で足し、`v<次>`を外す
3. `v<次>`を`dev`にマージする PR を作る（`dev`のバージョンが`<次>.0.0-rc.n`になる）。系列定義の変更も同じ PR に入れる
4. 手順3の一覧を直す
5. マージ後、`Release PR`を`promote=stable`で手動起動する（`npm-publish`スキル）。この Release PR は、正式版になる旧系列の定期 lock file maintenance を止める Renovate のルールを含む
6. `v<次>`ブランチをロックする（消さない）

## C. 正式版の公開後の整理

Issue に書かれた公開結果と lock file maintenance の停止を確かめ、次を行う：

1. 系列定義の旧系列に`successorStable`は書かない（`v<次>.0.0`のタグから読める）
2. `SECURITY.md`の旧系列の行にサポート終了日を書く（`release-automation classify`が出す日付）
3. npm の dist-tag：旧系列の次の公開で`v<旧>`が付くことを確かめる。`latest`が新しいメジャーを指していることを確かめる
4. 手順3の一覧のうち残っているものを直す

## D. 旧系列の終了

**終了日より前に、終了の効力を持つ PR のマージと設定変更をしない**。PR は準備してよい。

終了日以降に：

1. 系列定義から系列を外す
2. Renovate の`baseBranchPatterns`と旧系列のルールから外す
3. ワークフローの`branches:`から外す
4. `SECURITY.md`の行を「End of life」にする
5. ブランチをロックする（消さない。タグも残す）
6. その系列の`release-blocker`・audit Issue を、終了したことを書いて Close する

# 3. 系列名を書いている場所

- `.github/release-lines.json`
- `.github/renovate.json`（`baseBranchPatterns`、旧系列のルール）
- `.github/workflows/*.yml`の`branches:`
- `SECURITY.md`
- CLAUDE.md のブランチの記述
- GitHub の Ruleset と Environment の Deployment branches

`release-automation lines-check`で最初の4つを検査できる。残りは目で確かめる。

# 4. 検証

- [ ] `release-automation classify`がエラー0件で、系列が意図どおり
- [ ] `release-automation lines-check`がエラー0件
- [ ] 各系列のブランチへの PR で`ci-ok`・`full-ci-ok`が動く
- [ ] Nightly の次の実行で、全系列の Full CI が起動するか再利用される
- [ ] Renovate の次の実行で、Dependency Dashboard の対象ブランチが系列と一致する

全部が満たされるまで Issue を Close しない。
