import { describe, it, expect } from 'vitest'
import { loadAll, imageCapGaps, evaluate } from '../scripts/check-limit-provenance.mjs'

/**
 * C9（第三十五轮，由台账 A-08 的一手缺陷立出来）：凡调用 validateImages 的函数，
 * 必须同时对**被校验的那个数组**有条数 cap。
 *
 * 为什么这些用例全用合成输入：真仓今天是有 cap 的，任何"摘掉真 cap"的验证都不该常驻在
 * 测试里（那是变异演习的活）；合成输入既能钉住语义，也不依赖仓库当前状态。
 * 三条一手教训在这里钉死：
 *  ① 首版判据写成通用的 `.length > N`，被同函数里的**单张体积** cap（img.length > 2*1024*1024）
 *     顶替 ⇒ 摘掉真条数 cap 仍判绿（体积冒充条数）。
 *  ② cap 打在别的数组上（payload.items）也不算数 —— 必须与被 validateImages 的实参同路径。
 *  ③ 门禁必须收得下真话：cap 用命名常量 + too_many_images 出口的写法要判合法。
 */
const wrap = (body) => 'export async function f(db, payload) {\n' + body + '\n  return 1\n}'
const one = (body, rel = 'functions/lib/actions/x.js') => [{ rel, code: wrap(body) }]

describe('C9 图片条数 cap（合成输入自造前提）', () => {
  it('正向：cap 与被校验数组同路径 ⇒ 无 gap（判据不得只会红）', () => {
    const s = one([
      "  if (Array.isArray(clean.images) && clean.images.length > 5) return fail('too_many_images', '最多 5 张')",
      '  const c = validateImages(clean.images)',
    ].join('\n'))
    expect(imageCapGaps(s)).toEqual([])
  })

  it('反例①：只有 scheme 校验 ⇒ 点名到函数名与缺失的表达式', () => {
    const gaps = imageCapGaps(one([
      '  const c = validateImages(clean.images)',
      "  if (c === null) return fail('invalid_image', '格式无效')",
    ].join('\n')))
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toContain('functions/lib/actions/x.js:2')
    expect(gaps[0]).toContain('clean.images.length')
  })

  it('反例②（本轮一手假阴性）：同函数只有单张体积 cap ⇒ 仍须判红', () => {
    const gaps = imageCapGaps(one([
      '  const imgs = validateImages(clean.images)',
      '  for (const img of imgs) {',
      "    if (img.length > 2 * 1024 * 1024) return fail('image_too_large', '过大')",
      '  }',
    ].join('\n')))
    expect(gaps).toHaveLength(1)
  })

  it('反例③：cap 打在别的数组上不算数（必须与被校验实参同路径）', () => {
    const gaps = imageCapGaps(one([
      "  if (payload.items.length > 5) return fail('too_many_images', 'x')",
      '  const c = validateImages(clean.images)',
    ].join('\n')))
    expect(gaps).toHaveLength(1)
  })

  it('对偶：命名常量 + too_many_images 的写法合法（不逼着人写魔数）', () => {
    const s = one([
      "  if (clean.images.length > SUBMISSION_IMAGE_LIMIT) return fail('too_many_images', '最多若干张')",
      '  const c = validateImages(clean.images)',
    ].join('\n'))
    expect(imageCapGaps(s)).toEqual([])
  })

  it('解析失败不得当作"有 cap"（fail-closed：坏文件必须点名）', () => {
    // 面按**原文里是否出现 validateImages(** 划，再解析：若先解析失败就 continue，
    // 一个语法坏掉的图片出口会被静默放过（与 C8 的"零静默跳过"同一条红线）。
    const gaps = imageCapGaps([{ rel: 'functions/lib/actions/bad.js', code: 'export function broken( {\n  const c = validateImages(clean.images)\n' }])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toContain('bad.js')
    expect(gaps[0]).toContain('解析失败')
  })

  it('真仓现状：validateImages 出口全部带条数 cap，且分母非零', () => {
    const s = loadAll()
    const withImg = s.sources.filter((x) => x.code.includes('validateImages('))
    expect(withImg.length).toBeGreaterThanOrEqual(3)
    expect(imageCapGaps(s.sources)).toEqual([])
    expect(evaluate(s).filter((r) => r.id === 'C9' && !r.ok)).toEqual([])
  })
})
