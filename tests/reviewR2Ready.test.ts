// @vitest-environment jsdom
// R2 就绪垂直切片（2026-09-30 对标 P2）：后端白名单接 `r2:<key>` + 前端按基址解析。
// 不变量：注入向量仍被拒；未配基址时行为与旧版一致（恒等透传）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { isSafeImageUrl } from '../functions/lib/security.js'
import { resolveReviewImages } from '../src/utils/reviewImages'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('后端 isSafeImageUrl 接 r2: 引用', () => {
  it('合法 key 放行：字母数字/_.-，限长 128', () => {
    expect(isSafeImageUrl('r2:reviews/2026/abc-1.jpg')).toBe(true)
    expect(isSafeImageUrl('r2:a')).toBe(true)
  })
  it('注入向量仍被拒：scheme 冒充/路径穿越字符/超长', () => {
    expect(isSafeImageUrl('r2:javascript:alert(1)')).toBe(false)
    expect(isSafeImageUrl('r2:../secret')).toBe(false)
    expect(isSafeImageUrl('r2:')).toBe(false)
    expect(isSafeImageUrl(`r2:${'a'.repeat(129)}`)).toBe(false)
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeImageUrl('data:text/html,hi')).toBe(false)
  })
  it('旧口径不变：base64 与 https 照旧放行', () => {
    expect(isSafeImageUrl('data:image/jpeg;base64,AAA=')).toBe(true)
    expect(isSafeImageUrl('https://cdn.example/a.png')).toBe(true)
  })
})

describe('前端 resolveReviewImages 按基址拼接', () => {
  it('未配基址：恒等透传（含 r2: 引用不断言渲染）', async () => {
    vi.stubEnv('VITE_R2_PUBLIC_BASE', '')
    const imgs = ['data:image/jpeg;base64,AAA', 'r2:reviews/a.jpg']
    await expect(resolveReviewImages(imgs)).resolves.toEqual(imgs)
  })
  it('已配基址：仅 r2: 项拼接并去尾斜杠，其余原样', async () => {
    vi.stubEnv('VITE_R2_PUBLIC_BASE', 'https://img.example/')
    await expect(resolveReviewImages(['r2:reviews/a.jpg', 'https://cdn/x.png'])).resolves.toEqual([
      'https://img.example/reviews/a.jpg',
      'https://cdn/x.png',
    ])
  })
})
