# 07 分卷 53 —— 第三十五轮在册事实（2026-09-27）

> 出生字节受本轮新加的 `V4` 约束（新卷须留 ≥25% 余量 ⇒ ≤3,072B）。写这卷时它已经在管着自己。

## 一、本轮主题：登记表说的，和代码做的，必须互相作证

- **Step 0 台账 76 条**（45 仍有效 / 18 待复测 / 13 已失效；扫过 65 文件，`07-next-steps.part*` 实数 **51 卷**）。
  `TODO.md` / `TASKS.md` / `ROADMAP.md` / `memory/09-*` **全部不存在**；`05-feature-status` 的 🚧 区是空注释。
- **H0（台账 A-08/A-09）**：图片**条数**上限此前只活在前端 —— 4 个 `validateImages` 出口只有 `addReview` 有 cap，
  `createSubmission`（前端 ≤5）与 `createProduct`/`updateProduct`（前端 `slice(0,9)`）服务端不查，
  `docs/limit-provenance.md` 自己承认此事 ⇒ 三处补齐（`too_many_images`/400，两个产品出口同笔改）。
- **新判据 C9**（扩进 `check-limit-provenance`，不另立第二把尺）：**按函数核**，且 cap 必须打在
  被校验的那个数组上。首版被自己的变异体证伪 —— 通用 `.length > N` 把单张体积 cap
  （`img.length > 2*1024*1024`）当成条数 cap ⇒ 摘掉真 cap 仍绿。修后：变异点名 createSubmission 那条，还原即绿。
- **探针 9 条 + `ok()` 空标签守卫**：cap 断言要求 `errorCode`；首跑被**限流桶顶替**（`rate_limited`
  冒充"条数被拒"）⇒ 每条改用独立合成 `CF-Connecting-IP` + 前提自证断言。`verify-backend` 的 `ok()`
  现在拒绝空标签（真实事故：内联 shell 把 `${}` 吃掉，6 条断言落成 `ok(cond, )`）。

## 二、新闸 `verify:registry`（H1+H2 合并，接续 A-01/A-02/A-44）

- 一手数字：分发面 **39**（/pub 8 + /web 31，与 `api-contract.json` **双向逐字相等**）｜SQL 基线 **43 键**｜
  形状登记 **42 条** ⇒ 两张表各自多出**同样 3 条**越权/未知探针键，另加 `amortized:audit-retention-purge`
  （第二十八轮的桶，**迟到 6 轮**才入册）。R1~R6 全绿，例外 **4 条 / 7 键**。
- **例外理由必须可证伪**（含实测数字或反引号命令）⇒ 共用件 `scripts/lib/registry-reason.mjs`，
  `RESPONSE_GAPS` 与 `PROBE_EXCEPTIONS` 用同一份实现（同一事实只许一处判）。
- **例外册自身反查**：对不上任何登记键的例外判红，文案借 `rust-lang/rust` `tidy`
  （`Remove from EXCEPTIONS list if it is no longer used.`）。
- 对标件 `kubernetes/kubernetes`：`hack/verify-*.sh` 实测 **52** 个，聚合入口 `hack/make-rules/verify.sh:242`；
  机制 = `hack/lib/verify-generated.sh:35-60` **临时 worktree 里重跑生产者再看 `git status`**（不比 hash）；
  报错文案两件套 = 事实 + 修法（`"Generated files need to be updated" "Please run 'hack/update-codegen.sh'"`）。
> §三（体量与记忆治理）因本卷出生 3,708B 超 `V4` 上限 3,072B ⇒ 逐字拆入 **卷 54**（按节切，不压措辞）。
