# 07-next-steps 分卷 120（第六十轮「三件」正文整段迁出 · 同一轮 V3 让位）

> 换卷理由（数字实测）：主卷含本段时 4,228 B、余 -132 B（阈值 4,096 B／可写下限 256 B）⇒ V3 判贴死。
> V3 明写正解是迁整段、禁止压措辞换绿，故把「本轮做了哪三件」整段搬到这里；
> 下一轮真正需要的是它下面那条 P0 命令与在册红线，二者都留在主卷。

- 三件：① M-59-1 消费者 `functions/lib/event_sink.js` + `event_log` 表（migrate/rollback 成对进 `verify:migrate-replay` 回滚轨）；② M-59-2 `withTrace()` 端点层纯追加条件键 `trace`；③ R60-1 `sanitizeTrace`：`cf-ray`/`x-request-id` 是**外部可写值**，收口为「IP 洗白 → 剔 `[\w:.-]` 外字符 → 截 64」，producer 与日志/响应两侧出口各过一道。
