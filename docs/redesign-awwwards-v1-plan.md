# 视觉初版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在不改业务契约的前提下交付双端可浏览、可比较的鲜活市集视觉初版。

**Architecture:** 保留 React/HashRouter、现有 hooks 与本地/云端数据面；新组件负责品牌与外壳，页面组合业务与视觉，CSS 以作用域类覆盖新旧界面。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 3、Vite 8、Vitest、Playwright。

**Spec:** docs/redesign-awwwards-v1.md

## Global Constraints
- 保留内联商品编辑，禁止改为 modal/drawer/bottom-sheet。
- 不动生产数据、密钥、部署配置、functions/、db/ 与 public/admin|print|user|shared 上游文件。
- 分支 redesign/awwwards-v1，禁止推送主线。

## Review Focus
- 营业时间切换和打烊说明，tests/businessHoursHook.test.tsx。
- 商品名称/规格、加减购和金额，tests/productsTab.test.tsx 与 e2e。
- 内联编辑与批量操作的原位置与语义，ProductsTab 测试与截图。
- 390px 下固定底栏、图片和分类导航不横溢，Playwright 截图与 DOM 几何。
- 减少动效后内容仍全部可见，CSS media 规则与 computed style。

## Tasks

- [ ] 品牌组件与页面壳：BrandMark、CustomerHeader、MarketHero、WorkspaceShell；验证语义与渲染。
- [ ] 首页：全幅商品主视觉、购物入口、原服务分类与营业信息。
- [ ] 商城：品牌头、导航、真实商品画廊、原筛选/搜索/排序/购物车。
- [ ] 后台：侧栏/移动导航、宽内容面、原 tabs 与原行内编辑。
- [ ] 全局视觉：为其他顾客页面和后台 tab 提供统一令牌、字阶、间距、焦点和减少动效。
- [ ] 验证：目标测试、类型、lint、构建、后端与全量测试；截图逐张目检。
- [ ] 提交：检查 diff 与文件白名单，只提交本分支源码、设计文档和测试。

## 文件边界
- 新建 src/components/brand/{BrandMark,CustomerHeader,MarketHero,WorkspaceShell}.tsx。
- 修改 HomePage、CustomerPage、ProductCard、AdminPage、AdminGuard、index.css。
- 必要时修改 ProductsTab/ProductRow 与其他既有页面的 className，不改业务函数。
- 新建 tests/redesignVisual.test.tsx 与浏览器验证脚本（只放本地 _design-qa，不入业务包）。
