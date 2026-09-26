// 两侧同值必须被机器钉住（第十八轮 M6 扩面当场抓出的真缺陷）：
// 服务端 functions/lib/actions/reviews.js 一直是 `images.length > 3`（登记为产品决定），
// 而顾客端 ReviewForm 硬编码 5，屏上文案还写"最多 5 张" —— 顾客照提示选到第 4 张，
// 整条评价被服务端退回"最多上传 3 张图片"。**按屏上指示操作必然失败**，
// 且这类"另一半没管"的缺陷在 src/ 进普查面之前结构上不可见。
// 形态沿用 tests/batchChunkContract.test.ts：两条构建链不能共享模块 ⇒ 双写 + 等号契约。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const server = readFileSync('functions/lib/actions/reviews.js', 'utf8').replace(/\r\n/g, '\n')
const client = readFileSync('src/components/product/ReviewForm.tsx', 'utf8').replace(/\r\n/g, '\n')

const num = (re: RegExp, src: string, what: string) => {
  const m = re.exec(src)
  expect(m, `没解析到 ${what} —— 改名/换写法会让本契约静默失效，必须判红`).toBeTruthy()
  return Number(m![1])
}

describe('评价配图张数两侧契约', () => {
  const srv = num(/clean\.images\.length > (\d+)/, server, '服务端图片张数上限')
  const cli = num(/const MAX_REVIEW_IMAGES = (\d+)/, client, '前端 MAX_REVIEW_IMAGES')

  it('前端张数 == 服务端上限（等号：小了白限、大了必被整条退回）', () => {
    expect(cli).toBe(srv)
  })

  it('服务端确实用的是字面量 3（产品决定，登记在册）', () => {
    expect(srv).toBe(3)
    expect(readFileSync('docs/limit-provenance.md', 'utf8')).toContain('每条评价最多 3 张图')
  })

  it('前端不再有裸 5 的张数判断（防"常量加了、老地方还在用 5"）', () => {
    const codeOnly = client.split('\n').filter((l) => !/^\s*(\/\/|\{\/\*|\/\*)/.test(l)).join('\n')
    expect(codeOnly).not.toMatch(/images\.length < 5/)
    expect(codeOnly).not.toMatch(/slice\(0, 5\)/)
    expect(codeOnly).not.toMatch(/最多上传 5 张|最多 5 张/)
  })

  it('可见文案由常量渲染，不是写死的数字', () => {
    expect(client).toContain('添加图片（选填，最多 {MAX_REVIEW_IMAGES} 张）')
  })
})
