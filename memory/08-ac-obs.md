# 08 - AC-OBS 验收标准

> 本文件定义每个核心功能的可观测验收标准。
> 归档类型：增量（已验证的标准移入归档）
>
> 格式规范：
> AC-OBS-NN: [功能描述] → [验证方式] + [证据类型]
>
> 证据类型：截图 | 日志 | 测试输出 | API响应 | 数据库查询 | 视频录制

## 验收标准列表
- [x] AC-OBS-01: 单元测试全绿 → npm test 97 passed | 测试输出
- [x] AC-OBS-02: 类型检查 0 错误 → npm run typecheck | 测试输出
- [x] AC-OBS-03: 构建成功且 SW 版本 bump → npm run build 输出 ✓ built + [sw-version] | 测试输出
- [x] AC-OBS-04: public-api 独立路由可用 → POST /pub getPublicProducts 返回 code 0 + 49 商品 | API响应
- [x] AC-OBS-05: 管理接口可用 → POST /web getOrders/getProducts 带 adminKey 返回 code 0 | API响应
- [x] AC-OBS-06: 种子评价入库 → seedReviews 返回 added=20，tccli DescribeTables sm_reviews=20 | API响应 + 数据库查询
- [x] AC-OBS-07: 顾客评价与下单写链路 → /pub addPublicReview、createOrder 均 code 0，测试数据已删除 | API响应
- [x] AC-OBS-08: 静态站上线 → https://chaoshi-d2g5xfkao100010ef-1458054906.tcloudbaseapp.com HTTP 200 + 新 bundle | API响应
- [ ] AC-OBS-09: 浏览器人工验收 → 强刷后走通全链路，order20 显示猎兽图 + 评价可见 | 截图
