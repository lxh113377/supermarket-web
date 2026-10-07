# 07-next-steps · 第七十一轮 · 第 4 项详情（report:remote-divergence）

> 接 `07-next-steps.part155.md`。本卷是从该卷**整条迁出**的第 4 项，逐字未改。

4. **【低】`report:remote-divergence`：通道断时的机器可读存证。**
   本轮开工时 `github.com` 两路皆不通（代理拒连 + 直连 000）而 `api.github.com` 通 ——
   全仓没有一处能把"哪条通道还活着 + 本地压着几笔没推"取成读数。它与 `ci-green-contract`（答"基座红没红"）、
   `check-live-shape` L3（答"线上跑哪一版"）各答一个问题，不抢事实。
   最值钱的一条是 R2 的假绿防线：CI 的 `actions/checkout` 缺省 `fetch-depth: 1` ⇒ `HEAD == origin/main` 恒成立
   ⇒ "领先 0"会被读成"已同步"；所以 `--is-shallow-repository=true` 必须把计数折成 UNVERIFIED，
   且 API head ⇄ 本地 remote-tracking ref 不等时也不许拿旧 ref 算 ahead。
   ⚠️ 三条演习刻意**不叠在同一个开关**上：C6/R4 的回执是 rc=1（判红），R1/R2 的回执是 rc=2（尺残），
   合成一个 `--inject-red` 会让先红的那条 exit 掉后一条的读数。
   ⚠️ 写第一版时把 `rev-list --left-right --count` 的左右装反过（左=behind、右=ahead），
   夹具那条 `behind 在左、ahead 在右` 就是钉这个的 —— 装反的后果是"永远显示已同步"。
