# 02 - 仓库结构

> 本文件记录项目目录结构。sync 命令会自动更新此文件。
> 归档类型：快照（整体复制到归档）

<!-- SYNC_AUTO_GENERATED_START -->
```
├── .githooks/
│   └── pre-commit
├── .github/
│   ├── workflows/
│   │   └── ci.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── archive/
│   └── 2026-08-08-migration-tools/
│       ├── migrate-ts.mjs
│       └── repair-imports.mjs
├── cloudfunctions/
│   ├── admin-api/
│   │   ├── index.js
│   │   ├── index.test.js
│   │   ├── package-lock.json
│   │   ├── package.json
│   │   ├── seed-reviews.js
│   │   └── shared.js
│   ├── public-api/
│   │   ├── index.js
│   │   ├── package-lock.json
│   │   ├── package.json
│   │   └── shared.js
│   └── shared.js
├── docs/
│   ├── cloudbase-js-sdk-database-subpath-bug.md
│   ├── CODE_REVIEW_PROCESS.md
│   ├── CODE_REVIEW_STANDARD.md
│   ├── db-index-guide.md
│   ├── oxlintrc.recommended.json
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── REVIEW_CHECKLIST.md
├── public/
│   ├── images/
│   │   ├── sm/
│   │   │   ├── 1.webp
│   │   │   ├── 10.webp
│   │   │   ├── 11.webp
│   │   │   ├── 12.webp
│   │   │   ├── 13.webp
│   │   │   ├── 14.webp
│   │   │   ├── 15.webp
│   │   │   ├── 16.webp
│   │   │   ├── 17.webp
│   │   │   ├── 18.webp
│   │   │   ├── 19.webp
│   │   │   ├── 2.webp
│   │   │   ├── 20.webp
│   │   │   ├── 21.webp
│   │   │   ├── 22.webp
│   │   │   ├── 23.webp
│   │   │   ├── 24.webp
│   │   │   ├── 25.webp
│   │   │   ├── 26.webp
│   │   │   ├── 27.webp
│   │   │   ├── 28.webp
│   │   │   ├── 29.webp
│   │   │   ├── 3.webp
│   │   │   ├── 30.webp
│   │   │   ├── 31.webp
│   │   │   ├── 32.webp
│   │   │   ├── 33.webp
│   │   │   ├── 34.webp
│   │   │   ├── 35.webp
│   │   │   ├── 36.webp
│   │   │   ├── 37.webp
│   │   │   ├── 38.webp
│   │   │   ├── 39.webp
│   │   │   ├── 4.webp
│   │   │   ├── 40.webp
│   │   │   ├── 41.webp
│   │   │   ├── 42.webp
│   │   │   ├── 43.webp
│   │   │   ├── 44.webp
│   │   │   ├── 45.webp
│   │   │   ├── 46.webp
│   │   │   ├── 47.webp
│   │   │   ├── 48.webp
│   │   │   ├── 49.webp
│   │   │   ├── 5.webp
│   │   │   ├── 6.webp
│   │   │   ├── 7.webp
│   │   │   ├── 8.webp
│   │   │   └── 9.webp
│   │   ├── 1.webp
│   │   ├── 10.webp
│   │   ├── 11.webp
│   │   ├── 12.webp
│   │   ├── 13.webp
│   │   ├── 14.webp
│   │   ├── 15.webp
│   │   ├── 16.webp
│   │   ├── 17.webp
│   │   ├── 18.webp
│   │   ├── 19.webp
│   │   ├── 2.webp
│   │   ├── 20.webp
│   │   ├── 20_old.webp
│   │   ├── 21.webp
│   │   ├── 22.webp
│   │   ├── 23.webp
│   │   ├── 24.webp
│   │   ├── 25.webp
│   │   ├── 26.webp
│   │   ├── 27.webp
│   │   ├── 28.webp
│   │   ├── 29.webp
│   │   ├── 3.webp
│   │   ├── 30.webp
│   │   ├── 31.webp
│   │   ├── 32.webp
│   │   ├── 33.webp
│   │   ├── 34.webp
│   │   ├── 35.webp
│   │   ├── 36.webp
│   │   ├── 37.webp
│   │   ├── 38.webp
│   │   ├── 39.webp
│   │   ├── 4.webp
│   │   ├── 40.webp
│   │   ├── 41.webp
│   │   ├── 42.webp
│   │   ├── 43.webp
│   │   ├── 44.webp
│   │   ├── 45.webp
│   │   ├── 46.webp
│   │   ├── 47.webp
│   │   ├── 48.webp
│   │   ├── 49.webp
│   │   ├── 5.webp
│   │   ├── 6.webp
│   │   ├── 7.webp
│   │   ├── 8.webp
│   │   └── 9.webp
│   ├── alipay.jpg
│   ├── favicon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icons.svg
│   ├── manifest.json
│   ├── sw.js
│   └── wechat-pay.png
├── scripts/
│   ├── check-import-cycles.mjs
│   ├── create-cloudbase-indexes.mjs
│   ├── gen_placeholder_images.py
│   ├── scan-secrets.mjs
│   └── verify_images.py
├── src/
│   ├── assets/
│   │   ├── hero.png
│   │   ├── react.svg
│   │   └── vite.svg
│   ├── components/
│   │   ├── AdminGuard.tsx
│   │   ├── CartItem.tsx
│   │   ├── DashboardTab.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── OrderItem.tsx
│   │   ├── OrdersTab.tsx
│   │   ├── ProductCard.tsx
│   │   ├── ProductsTab.tsx
│   │   ├── ReviewsTab.tsx
│   │   ├── SubmissionsTab.tsx
│   │   └── TopNav.tsx
│   ├── data/
│   │   ├── products-seed.ts
│   │   ├── reviews-seed.ts
│   │   └── services.ts
│   ├── db/
│   │   ├── cloud.ts
│   │   ├── cloudInit.ts
│   │   ├── orders.ts
│   │   ├── products.ts
│   │   ├── reviews.ts
│   │   └── submissions.ts
│   ├── hooks/
│   │   ├── useCart.ts
│   │   └── useProducts.ts
│   ├── pages/
│   │   ├── AdminPage.tsx
│   │   ├── CartPage.tsx
│   │   ├── CategoryPage.tsx
│   │   ├── CustomerPage.tsx
│   │   ├── HomePage.tsx
│   │   ├── OrderConfirmPage.tsx
│   │   ├── OrderSuccessPage.tsx
│   │   ├── PaymentPage.tsx
│   │   ├── ProductDetailPage.tsx
│   │   └── ServiceFormPage.tsx
│   ├── utils/
│   │   └── businessHours.ts
│   ├── App.tsx
│   ├── auth.ts
│   ├── cart.ts
│   ├── catalogCache.ts
│   ├── cloudbase.ts
│   ├── db.ts
│   ├── index.css
│   ├── localStore.ts
│   ├── main.tsx
│   └── types.ts
├── tests/
│   ├── authWhitelist.test.js
│   ├── businessHours.test.js
│   ├── cart.test.js
│   ├── catalogCache.test.js
│   ├── dbFacade.test.js
│   └── shared.test.js
├── tmp/
│   └── 20cand/
│       ├── 20_cutout.png
│       ├── 20_processed.png
│       ├── cand2.jpg
│       ├── cand3.jpg
│       ├── cand4.jpg
│       ├── cand5.jpg
│       ├── cand6.jpg
│       ├── cand7.jpg
│       └── current20.png
├── .env
├── .env.example
├── .oxlintrc.json
├── cloudbaserc.json
├── HANDOFF.md
├── index.html
├── package-lock.json
├── package.json
├── postcss.config.js
├── README.md
├── tailwind.config.js
├── tsconfig.json
└── vite.config.js
```
<!-- SYNC_AUTO_GENERATED_END -->

## 模块说明
<!-- 手动补充：各模块/目录的用途 -->
- `src/` — 
- `tests/` — 
