# 07 分卷 60 —— 第三十七轮在册事实（2026-09-27）

> 出生字节受 `V4` 约束（≤3,072B）。基准锚：内层 `f96cdf9`（R36 再收尾）、外层 `1e4b751`。

## 一、Step 0 台账（第 37 轮基线，逐条带取证时刻）

- 07 系 **59 文件 / 164,543B / 未勾 70 条**（`ls | wc -l`、`cat | wc -c`、`grep -c "^- \[ \]"` @13:12Z）。
  与 R36 的"55 文件 / 153,748B / 未勾 70"对照：文件 +4、字节 +10,795、**未勾条数不变** —— 说明"未勾 70"
  里有已完成的陈旧项（本轮就抓到 `part30` 仍挂着 `src/cart.ts:51-53 单键合行未修`，而 R36 已修完）。
- `TODO.md` / `TASKS.md` / `ROADMAP.md` 两仓仍全部不存在（逐个 ls）。
- 双份记忆**不是** junction 双跟踪：内层 `git ls-files memory` = 71 件、外层 `超市/memory` = 14 件，
  `comm -12` 按文件名交集 **为空** ⇒ 是两份内容不同的账（R272 那族是"同一份两跟踪"，别归错因）。
- 旧阻塞重跑：**M4 本机 workerd 已自愈**（`workerd.exe` 实存 + `wrangler --version` = 4.137.0）⇒ 挂自
  第十六轮的那条按"已完成"结案；**M3 分支保护仍 `NOT_ENFORCED`**（`protection=404` + `rulesets=200`
  无生效规则 @2026-09-27T13:16:35Z）。

## 二、本轮做完的三件

1. **H1 备份第三条出路（加密再上传）**。新 `scripts/backup-crypto.mjs`：AES-256-GCM + scrypt
   （`N=2^15,r=8,p=1`，取舍写在文件头：不抄 age 的 `2^18` 是因为解密必须能在低配机器上跑通）、
   定长头 `SMBK|v|salt|iv|tag|ct`、**口令只走 env**（未知 flag 一律 rc=2，argv 传口令会进 `ps` 与日志）。
   工作流改**三态**：private→明文放行 / 非 private 且有口令→加密放行 / 非 private 无口令→红；
   守卫仍排在导出之前。分母先取再做：本机 seed = **9 表 / 56 行 / JSON 15,400B**，最大单表 INSERT 体
   16,864B ≪ `d1_statement_bytes 100000` ⇒ 体积不是瓶颈；**现网行数 UNAVAILABLE**（缺凭据 + `d1 execute`
   须先过部署 skill ⇒ 不拿本机数冒充实测）。**产物存在 ≠ 备份可用** ⇒ 上传前 `--verify` 解回逐字节比对，
   然后把明文从上传面摘掉。对标原文：`actions/upload-artifact` README:123（"Users must be logged-in"=
   public 仓产物任意登录用户可下载）、`FiloSottile/age` README:174/182/256。
