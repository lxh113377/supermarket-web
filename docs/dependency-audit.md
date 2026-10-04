# 依赖审计分面账（第六十六轮立）

> 立件理由：`npm run audit:deps` 从"全量树"改成"生产树阻断 + 全树只报"两腿。**分面不是降档** ——
> 两条腿都在 CI 上跑，只是只有生产树那条有拦提交的权力。本文件是那条权力边界的账，
> 也是"具名欠账"的登记处（欠账不在这里点名，就等于没记）。
> 复算：`npm run audit:deps`（生产腿）与 `npm run audit:deps:full`（全树腿）。

## 读数（2026-10-04 本机实测，registry=官方）

| 腿 | 命令 | rc | 读数 |
|---|---|---|---|
| 生产树（阻断） | `npm run audit:deps` | **0** | 1 moderate（echarts），high/critical = 0 |
| 全树（只报） | `npm run audit:deps:full` | 1 | 5 high + 1 moderate，共 6 条 |

阈值两条腿都是 `--audit-level=high`，**未调低**。CI 步骤名自带「阻断」/「只报不拦」字样，
所以从 run 页面上就能看出哪条有权拦（同 `verify:cli-legs` 的"会红必须有牙、不红也必须看得见"口径）。

## 5 条 high 的归属与为什么不由本轮修

一条根，四条果，全在**构建期**链上，生产 bundle 里不含它们：

```
tailwindcss@^3.4.19 (devDependencies)
  └─ chokidar@3.6.0        ← 2.0.0–3.6.0 受影响
       └─ braces@3.0.3     ← GHSA-vfj7-8cjw-p6xm，本 advisory 下"全部版本受影响"
  └─ fast-glob@3.3.3 → micromatch@4.0.8 → braces（同一根）
```

- **`braces` 没有任何已发布的修复版**：实测 `npm view braces versions` 最新即 `3.0.3`，
  而 lock 里装的**就是** 3.0.3 ⇒ "升到修复版"这条路不存在。
- npm 给出的唯一修法是 `tailwindcss@4.3.3`（`isSemVerMajor: true`）。Tailwind 3→4 是
  **配置格式与 PostCSS 插件位置的迁移**（`@tailwind` 三条指令在 `src/index.css:1-3` 真实在用，
  `postcss.config.js:3` 挂着插件 ⇒ 不是死依赖，不能删了了事）。
- 可利用性：该条是**深度嵌套 glob 模式导致栈耗尽（DoS）**，输入面是仓内静态文件
  `tailwind.config.js` 的 `content` 模式，**不接受任何外部输入** ⇒ 运行期不可达。
  （这句是可被反驳的：若哪天 content 模式改成由用户/请求拼出来，本段作废并升级为阻断项。）
- ⇒ 结论：它是一条**真实但不可达、且唯一修法是一次无人评审的框架大迁移**的欠账。
  拿它拦提交，会逼下一次会话在老大不在场时动 Tailwind 大版本 —— 那是拿交付换账面。

## 阻断腿的牙齿：可逆注入实测（第六十七轮补，销 D-66-4 欠账）

上一轮把两腿立起来时，只证明了生产腿**现在 rc=0**（读数表那两行）——
**「现在是 0」不等于「它能拦」**。按"判据宣称抓 X 前须真件可逆注入见红"的纪律，
第六十七轮做了一次真注入：在一份**一次性副本**里把一个生产依赖钉到已知高危版本，
再跑**生产腿自己的命令**，看它是否当场变红。

```bash
# 复算命令（全部在一次性临时目录里做，不碰本仓；注入可逆 = 删掉临时目录即可复原）
d=$(mktemp -d) && cd "$d"
printf '{"name":"audit-drill","version":"1.0.0","private":true,"dependencies":{"lodash":"4.17.15"}}' > package.json
npm install --package-lock-only --registry=https://registry.npmjs.org --no-audit --no-fund
npm audit --omit=dev --registry=https://registry.npmjs.org --audit-level=high ; echo "prod leg rc=$?"
```

| 读数 | 值 |
|---|---|
| 注入的生产依赖 | `lodash@4.17.15`（**在 `dependencies`，不在 `devDependencies`**） |
| 生产腿 `audit:deps`（`--omit=dev --audit-level=high`） | **rc=1**，逐条点名 6 条 high（GHSA-35jh-r3h4-6jhm / p6mc-m468-83gw / 29mw-wpgm-hmr9 / r5fr-rjxr-6jc / f23m-r3pf-42rh / xxjr-mmjv-4gpg） |
| 同夹具上全树腿 `audit:deps:full` | rc=1（与生产腿同向，符合预期：注入的是生产依赖） |

⇒ **生产腿确实有牙**：它不是"永远 rc=0 的装饰"，也不是"只看 dev 的假闸"。
第 54 行那句反例腿的说法，从本轮起是**实测过的**，不再是推断。

⚠️ **边界，别读宽**：这是一次**一次性实测**，不是常驻 CI 测试。
它没有回归保护 —— 明天有人把 `--omit=dev` 删掉、或把阈值调低，这条读数不会自己变红。
真正常驻并钉住"分面形状没被改回去"的是 `tests/ciWorkflow.test.ts` 的 step 存在性断言
（改名/删除 step 即红）。本段只负责回答另一个问题：**这条闸在原理上能不能拦**。

## 具名欠账（不随本文件关闭）

| # | 项 | 严重度 | 面 | 处置归属 | 验收 |
|---|---|---|---|---|---|
| D-66-1 | `echarts@^5.6.0` XSS（GHSA-fgmj-fm8m-jvvx），修复要 6.1.0（major） | moderate，**生产依赖** | 运行时渲染看板，且本仓有深路径 import 契约（`echarts/lib/*`，见坑 #35） | **需 ADR + 回归验收**，属用户拍板类（改法会动到 SSR 判据与产物级判据两条腿） | 升 6.x 后 `verify` 全绿 + SSR 判据出图 + 管理端 4 张 canvas 非零尺寸 |
| D-66-2 | Tailwind 3.4→4.3 迁移（清掉本文件那 5 条 high 的唯一路径） | high×5，**仅 dev 工具链** | 构建期 | 需一次带视觉回归的专项轮（`test:visual` 基线必须逐张看过） | 迁移后 `audit:deps:full` rc=0，且视觉基线不漂 |
| D-66-3 | `check:doc-commands` 台账须随两腿新别名重算 | — | 判据自身 | 第六十六轮已做（`npm run check:doc-commands -- --update`） | 台账与 `package.json` 别名双向差集为空 |
| D-67-1 | 生产腿的"可逆注入见红"目前是**一次性实测**，无常驻回归保护 | — | 判据自身 | 归口：要么把上面那段演练接成一条 advisory CI step（代价：每次 push 多一轮 npm registry 往返），要么明确接受"靠 `ciWorkflow.test.ts` 守形状、守不住牙齿" | 由用户拍板；未拍板前**禁止**把本段读数说成"已有回归保护" |

## 为什么这不是"把红线偷偷挪松"

1. 阻断腿判的是**上线产物真含的依赖**——顾客端与后台 bundle 里跑的代码。
2. 全树腿**照常跑、照常红、照常印在 run 页面**（`continue-on-error: true` 只改阻断力，不改可见性），
   本文件把它的每一条都点了名并写了归属与验收判据。
3. 两条腿的 `--audit-level` 同值（`high`），没有任何一条被调低或加 `--production --audit-level=critical` 之类。
4. 反例腿：若哪天生产依赖里出现一条 high（例如 D-66-1 升档失败或被别人改坏），
   `audit:deps` 立刻 rc=1 并拦下 `build-and-test` ⇒ 阻断力仍在，只是不再由构建期工具链行使。
