# 05 - 功能状态

> 本文件记录各功能的实现状态。
> 归档类型：增量（已实现的项移入归档）

## ✅ 已实现
- [x] 顾客购物链路 — 商品浏览/搜索/加购/下单/支付轮询，房间号+联系方式+备注+付款截图落库
- [x] 订单服务端重算 — createOrder 服务端计价防篡改，items 冗余 subcategories（看板分类占比修复）
- [x] 评价体系 — addPublicReview 公开提交（评分 1-5 钳制、昵称/文本截断、图片≤5张≤2MB、限流），云端优先+本地降级
- [x] 种子评价 — seedReviews 幂等管理 action，线上已导入 20 条（覆盖 15 个商品）
- [x] 商品多图 — PRODUCT_FIELDS 含 images，详情页轮播，管理端内联编辑多图 URL/主图/排序
- [x] 数据卫生 — 移除前端错误上报污染 sm_submissions；public-api 商品上限 1000
- [x] TypeScript 迁移 — 41 个 src 文件全部 .ts/.tsx，strict 模式 0 错误
- [x] GUI 打磨 — SubmissionsTab 品牌色、HomePage 渐变、CustomerPage 重试按钮、内联错误文案、aria-label
- [x] 商品图修正 — order20 从错误的东鹏特饮广告图替换为 OCR 验证的猎兽 PREDATOR 500ml 白底抠图
- [x] 全量上线 — hosting 128 文件 + admin-api/public-api 云函数 + /pub 独立 HTTP 路由（tccli 创建）

## 🚧 开发中
<!-- 暂无 -->

## 📋 计划中
- 📋 评价晒图改云存储直传（当前为 base64 入库，最大 5 张 × 2MB，量大后建议 COS 临时签名直传）
- 📋 顾客账号体系（当前匿名登录关闭，下单免登录，仅房间号+联系方式）
- 📋 部署自动化脚本（密钥注入/占位符还原/双函数冒烟测试一键化）
