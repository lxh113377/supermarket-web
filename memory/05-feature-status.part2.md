# 05-feature-status.part2.md

<!-- 本卷为 05-feature-status.md 的延续 -->

- [x] **详情页面包屑取真实分类（2026-09-25）** — 由硬编码「首页 › 生活 › 零食饮料」改为按 `product.subcategories` 派生，两级链接指向 /shop 深链可真的点回去；实测 order 16 → 饮品›提神、order 24 → 饮品›矿泉水。
- [x] **商品图治理（2026-09-25）** — 11 张问题图重做 9 张（必应 murl 链路 + 联络表目检 + 全尺寸规格体检，拦下 250ml/330ml/555ml 规格冲突与茄汁味/茉莉清茶/甘师傅串图）；order 20 三轮无合格素材、order 51 已下架，均维持原图。**注意：9 张里 6 张对应商品处于下架态，线上当前只有 6/17/53 真正生效。** 详见 CHANGELOG 追加十三/十四。
- [x] 管理后台 — 数据看板（echarts 按需）、商品内联编辑（禁弹窗）、订单管理、评价管理、服务表单流转
- [x] 后端 — `/web` 30 action + `/pub` 8 action + `/_health`；服务端重算金额、字段白名单、图片 scheme 白名单
- [x] 履约闭环（2026-09-24 对标轮）— 订单 5 态状态机（pending→paid→delivering→completed，旁路 cancelled；服务端 ORDER_TRANSITIONS 强制，status TEXT 零迁移）；顾客侧 `/pub getOrderStatus` 进度轮询（修复旧轮询误用 adminCall 必然鉴权失败的缺陷）；前后端迁移表 parity 测试锁定
- [x] 库存防超卖（2026-09-24 裁决轮，对标 C1）— products.stock（-1 不限售）；下单守卫式占用/取消与删除回补/误取消恢复重占用；管理端内联编辑库存字段 + 缺货/低库存角标；verify-backend +18 断言
- [x] 订单查询页 #/order-query（2026-09-24，对标 litemall 订单跟踪）— 输单号看 5 步进度；成功页单号展示/复制/查询入口，sessionStorage 跨导航兜底
- [x] 超时单工作台（对标第三轮 B5）— OrdersTab 内联面板接 `stalePendingReport`：汇总/库存占用明细/"已传付款截图"徽标/逐单取消（复用状态机+回补路径；禁弹窗；只读密钥静默降级）
- [x] 工程防线（对标第三轮 C1/C2/B4）— 单 action SQL 语句峰值基线 `docs/sql-baseline.json`（verify-backend 内置，N+1 回归 CI 红）；生产依赖 license 白名单门禁 `verify:licenses`（GPL/AGPL/LGPL/SSPL/Elastic/未知拦）；页面层覆盖率 19.68%→23.65%，阈值棘轮 23/21/20/24
- [x] 防线轮 K1+K2（2026-09-25）— 三块门面首次进故障路径断言（`api/client.ts` 超时/非 JSON/缺 code/网络抛错/端点选择/密钥退化、`localStore.ts` 播种判定/浅拷贝/越界钳制、`auth.ts` 写失败仍失效）；**修掉两处真实失效缺陷**（`db/reviews.ts` 三处"只在成功才失效" + `updateOrderStatus`/`deleteOrder` 零失效），收口为 `catalogCache.withCacheInvalidation(fn, invalidate?)`；新增真浏览器门禁 `e2e-cloud-stub`（生产构建 + 假桩，断四图真出 canvas 与零未捕获异常）并**首次把 `e2e` 与新 job 一起列入 `deploy.needs`**（此前 e2e 红了也照常部署）。631 用例 63 文件，stmts 80.91/branches 74.08/func 76.41/lines 82.52，棘轮 **78/72/74/80**。反例自证 18/18。详见 CHANGELOG 追加十八。

## 分卷目录
- **卷1** `05-feature-status.part1.md` — 05-feature-status 分卷（R199 自动拆卷）

