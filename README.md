# 超柿 Web

寝室/校内超市在线购物系统。顾客端浏览下单，管理员后台管理商品和订单。

- **前端**: React 19 + Vite 8 + Tailwind CSS 3 + HashRouter
- **后端**: 腾讯云 CloudBase（NoSQL 数据库 + 静态托管）
- **支付**: 展示微信/支付宝收款二维码

## 网址

- 顾客端：`https://chaoshi-d2g5xfkao100010ef-1458054906.tcloudbaseapp.com/#/`
- 管理后台：`https://chaoshi-d2g5xfkao100010ef-1458054906.tcloudbaseapp.com/#/admin`

## 本地开发

```bash
cd supermarket-web
npm install
cp .env.example .env    # 填入 CloudBase 配置
npm run dev             # http://localhost:5173
```

## 部署

```bash
npm run build
npx tcb hosting deploy dist -e <envId>
```

需先安装并登录 `@cloudbase/cli`：
```bash
npm install -g @cloudbase/cli
tcb login
```

## 环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `VITE_CB_ENV_ID` | CloudBase 环境 ID |
| `VITE_CB_ACCESS_KEY` | CloudBase API 密钥（可选，不填走匿名登录） |
| `VITE_ADMIN_KEY` | 后台管理密码（自定义字符串） |

## 替换收款码

将你的微信和支付宝收款二维码图片覆盖 `public/` 目录下的同名文件：
- `public/wechat-pay.png`
- `public/alipay.jpg`

之后重新 `npm run build && npx tcb hosting deploy dist`。

## 匿名登录模式（推荐，更安全）

默认使用 accessKey 鉴权。切换到匿名登录可避免密钥暴露在前端代码中：

1. CloudBase 控制台 → 环境 → 登录授权 → 开启「匿名登录」
2. 集合安全规则：`sm_products`、`sm_categories` 设置 `read: true`、`write: auth != null`
3. 删除 `.env` 中的 `VITE_CB_ACCESS_KEY`
4. `VITE_ADMIN_KEY` 需要配置到云函数 `admin-api` 的环境变量中
5. 重新 build + deploy

## 项目结构

```
src/
├── pages/
│   ├── CustomerPage.jsx    # 顾客浏览
│   ├── CartPage.jsx         # 购物车
│   ├── OrderConfirmPage.jsx # 确认订单
│   ├── OrderSuccessPage.jsx # 下单成功
│   ├── PaymentPage.jsx      # 支付方式
│   └── AdminPage.jsx        # 管理后台
├── components/              # UI 组件
├── cloudbase.js             # CloudBase SDK 初始化
├── db.js                    # 数据库操作
├── auth.js                  # 管理端写操作
├── cart.js                  # 购物车 localStorage
├── localStore.js            # 本地模式数据兜底
└── data/products-seed.js    # 种子商品数据
```
