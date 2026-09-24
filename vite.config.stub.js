// 本地"云端模式"浏览器验收专用配置：envDir 指向 tests/env-stub（内含 .env.stub）。
// 用法：`npm run build:stub` 后交给 `npm run serve:stub` 伺服，即可在**不使用生产密钥**的前提下
//       走通 登录 → 看板（真 echarts 渲染）→ resize 这条云端路径。
// ⚠️ 仅用于本地验证，严禁把这份产物上线（端点是同源相对路径、接口是假桩）。
import path from 'path'
import { fileURLToPath } from 'url'
import base from './vite.config.js'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default { ...base, envDir: path.join(dir, 'tests', 'env-stub') }
