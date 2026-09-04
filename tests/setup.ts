// vitest 全局 setup：为 RTL 注册自动 cleanup（vitest 非 globals 模式不自动清理，防测试间 DOM 叠加）
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
