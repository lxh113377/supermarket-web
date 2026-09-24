// e2e 专用 vite 配置：envDir 指向空目录，屏蔽本机 .env（VITE_CB_API_BASE 会把前端切到
// 云端模式，导致基于本地演示模式的冒烟断言全部失效）；CI 无 .env 时行为不变。
import path from 'path'
import { fileURLToPath } from 'url'
import base from './vite.config.js'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default { ...base, envDir: path.join(dir, 'tests', 'e2e', 'env-empty') }
