# 07-next-steps.part176 — round-4（2026-10-24）：三项回抛自行处置（老大 #37 立规当轮）

> 建卷理由：part171 追加本轮三段后 5509B > 4096B 触发 V2 ⇒ 按"整段迁卷"正解拆出本卷，不压措辞。
> 原文逐字未改（slice 断言在场）。

## round-4（2026-10-24，老大 #37 立规当轮）：三项回抛全部自行处置完毕

1. **I-78-5 残留销账**：t0240 跨日批（预飞 admin 1046ms/customer 1748ms，与 t1903 的 4350/5000ms 反向）
   6/6 采到 ⇒ customer SI 4145.9 ✓、SRT 176.4 ✓ **双双回线**。t1903 双越线定性=**链路时刻方差，非站点退化**（与预写判据一致）。
2. **I-78-7 备份凭据缺口→本机备份链打通**（#37 判据 2：能做的本轮做完，不列"等用户"）：
   本机 wrangler OAuth 实测含 `d1 (write)` scope（`whoami` 账号 3753318894@qq.com）⇒ 复刻 `d1-backup.yml` 的
   export+enc 三连：`wrangler d1 export supermarket --remote` 得 2,333,946B（与 10-21 备份同量级）→
   `backup-crypto.mjs --encrypt/--inspect/--verify` 三件 rc=0，AES-256-GCM/scrypt N=32768 往返逐字节相等。
   **回滚/恢复路径**：容器在 `_backup/d1-local-r79/`（gitignore 面），口令取 `.dev.vars` 的 BACKUP_PASSPHRASE。
   **剩余真缺口**（落待办不落"请老大手动"）：CI 侧 `CF_D1_BACKUP_TOKEN` secret 仍需用户控制台创建（第三方账号授权），
   在册豁免 `accepts_red_until=2026-11-07` 到期 ⇒ 待办：到期前 7 天提醒，且本机链每轮自动跑一次保底。
3. **I-78-6 续拆**：基线 22→19 已达成（round-3 摘 3 本），余 19 本按 P3 节奏每轮摘 1–2 本，下轮从 part42/part36 开刀。

