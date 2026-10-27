# 09 · 动作清单与风险分级（原生化剩余的 34 个）

> 本件是「45 个动作逐个原生化」的排期面。数据来源两处：**契约真值** `docs/api-contract.json`（我逐条数过）
> + **委派审计**（子代理读 `functions/lib/backend.js` 的分派表，逐条给行号与依赖；产出已入库并在 §2 对账）。

## 1. 先把数字对清楚（目标里的「45」与实际契约不同）

| 口径 | 数 | 说明 |
|---|---|---|
| 端点槽位 | **44** | `/web 35` + `/pub 9`（同一动作可同时挂在两端） |
| 去重后的动作名 | **37** | 7 个名字双端同源（如 createOrder / getReviews / getOrderStatus / addPublicReview / createSubmission 等） |
| 已原生化 | **17** | 公开面 5：getPublicProducts / getPublicCategories / getCatalogOrders / getReviews / getOrderStatus；管理面 8：getProducts（第 6 轮）、getAllReviews / getSubmissions / getSubmissionImages / getEventLog（第 7 轮）、getStockMovements（第 8~9 轮）、**getOrders / getOrder（第 10 轮）**、**verifyKey / stalePendingReport（第 11 轮）**、**getPromotions（第 12 轮）**、**getDashboardStats（第 13 轮）** ——均见 docs/08 |
| **剩余** | **20** | 34 − 第 5 轮 2 − 第 6 轮 1 − 第 7 轮 4 − 第 9 轮 1 − 第 10 轮 2（剩 getDashboardStats 的 KV 分键缓存、getPromotions 聚合、stalePendingReport、verifyKey，以及全部写动作与 login/两个 AI 动作） |

**结论**：目标里的「45」应按 **44 槽 / 37 名** 执行；写代码前先对齐数字，免得后面按错误分母报进度。

## 2. 风险分级（委派审计产出 + 我的两处校正）

### ① 纯读·无写·可缓存（9 个）

| 动作 | 备注（行号 = backend.js 分派处） |
|---|---|
| verifyKey | 纯密钥/角色比对，零 DB（:109）——**但它要的是鉴权语义**，不是数据语义 |
| getProducts / getStockMovements / getEventLog | 各自单表只读（:112 / :124 / :133） |
| getAllReviews / getReviews / getOrderStatus | 单表只读（:149 / :150·:261 / :152·:262） |
| getSubmissions / getSubmissionImages | 单表只读（:162 / :163） |

**校正一（重要）**：这一档里除 getReviews / getOrderStatus 外**都是管理端动作**，
原生化它们要先在边缘实现 **ADMIN_KEY 鉴权**（常时比较、401 形状、role 判定、verifyKey 的语义）。
也就是说：这一档**不是「免费」的**；真正的低风险第一批是那两个公开读（无鉴权、无写、可缓存）。

### ② 读·有额外依赖（8 个）

| 动作 | 依赖（行号） |
|---|---|
| login | rate:login 限流（KV→D1 回落）+ 落 security_events 审计 INSERT（:105，限流:78、审计:203） |
| stalePendingReport | orders+products 两表（:127） |
| getOrders / getOrder | orders LEFT JOIN order_discounts（:128 / :129） |
| getPromotions | promotions + order_discounts 聚合（:131） |
| aiAdvice | KV 60s + rate:aiadv + Dify 外部 + 三表快照 + ai_calls 留痕（:166） |
| getDashboardStats | rangeDays 分键 KV 60s + 三表聚合（:174） |
| aiChat | rate:ai:{ip} + Dify 外部（无缓存）+ ai_calls（:273） |

### ③ 写·改 D1 行（17 个）

| 动作 | 副作用（行号） |
|---|---|
| createProduct / updateProduct / deleteProduct | products 增改删，带库存时并写 stock_movements（:113 / :114 / :115） |
| batchUpdateProducts / batchDeleteProducts | IN 批量（:117 / :118） |
| createOrder | INSERT orders(+order_discounts) + UPDATE products 扣库存 + 流水；公开端另有限流与订单通知（:121 / :253） |
| deleteOrder / updateOrderStatus | 删除/改状态，**取消或恢复时回补或占用库存**（:119 / :120） |
| recalculateOrders | 批量 UPDATE orders + UPSERT order_discounts（:122） |
| adjustStock | UPDATE products + 写 stock_movements（:125） |
| addReview / addPublicReview / deleteReview / seedReviews | reviews 增删（:154 / :153·:263 / :159 / :160） |
| createSubmission / updateSubmissionStatus / deleteSubmission | submissions 增改删（:161·:268 / :164 / :165） |

## 3. 校正二：三个「契约标只读、实际有 D1 写副作用」的边界项

委派审计点出来的这条**比清单本身更值钱**，原样记下：

- login：契约 write:false，但它**写 security_events 审计**（登录成功/失败都要留痕）；
- aiAdvice / aiChat：契约只读，但**写 ai_calls 留痕**，且限流 KV 未命中时会回落写 rate_limits。

**对原生化的直接后果**：这三个若按「纯读」端口，会**静默丢掉审计与限流** —— 功能测试全绿、安全性被削。
所以它们必须与写动作同一套纪律（逐条带副作用对账 + 回滚演练），不能因为契约标了 write:false 就放进低风险档。

## 4. 下一批（建议顺序）

1. ~~公开读的剩余两个~~ **已于第 5 轮完成**（docs/08 §2b：8 个端到端用例全绿）；**注意实况纠正**——这两个动作现网**没有** KV 缓存，
   原生化时它们**不能**进微缓存（多缓存一次就是行为改变），判据里已按「不可缓存必须不 hit」钉住；
2. ~~管理端只读 + 鉴权~~ **第 6 轮已完成鉴权层与第一条 getProducts**（docs/08 §2c：鉴权语义 + 三张动作表同步 + 审计写入条数全绿）；
   其余 8 个管理只读（getStockMovements / getEventLog / getOrders / getOrder / getStalePendingReport / getDashboardStats / getPromotions / aiAdvice）**可直接沿用**，只差各自的 SQL 与映射；
3. **带依赖的读**：getDashboardStats（KV 分键缓存语义要抄准）、getOrders（LEFT JOIN）；
4. **写动作**：createOrder 先行，但必须带幂等指纹、库存占用与并发校验的值级对账；
   login / aiAdvice / aiChat 按 §3 的结论**并入写动作档**。
