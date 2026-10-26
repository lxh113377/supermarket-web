import { describe, it, expect } from 'vitest'
import { matchShelf } from '../src/components/service/AnswerShelf'

// matchShelf 是「答案里长出货架」的唯一取数口。它一旦永不命中，那个组件就永远不出货 ——
// 而**这正是本轮反复修的形态**（FlyDot 用正则解 productId 猜序号，永不匹配、静默不渲染，
// 构建/lint/单测三层都看不见）。所以这里第一件事不是测样式，是**亲眼看它命中真数据**。
describe('matchShelf（答案 → 在售商品）', () => {
  it('正向：答案原文点过名的商品必须被挑出来（用目录里的真名字，不是编的）', () => {
    const hits = matchShelf('天热的话推荐东方树叶青柑普洱，或者和其正凉茶也不错。')
    expect(hits.length, '零命中 ⇒ 匹配逻辑或归一函数坏了，组件会永远不出货').toBeGreaterThan(0)
    expect(hits.map((h) => h.name)).toContain('东方树叶青柑普洱')
    // 每件都必须是「答案里真出现过」的 —— 这是本组件的诚实口径，不许联想推荐
    for (const h of hits) expect('天热的话推荐东方树叶青柑普洱，或者和其正凉茶也不错。').toContain(h.name)
    for (const h of hits) {
      expect(h.id).toBe('p_' + h.order)
      expect(h.price).toBeGreaterThan(0)
    }
  })

  it('归一抗噪：全角、空格、书名号打断名字时仍要命中（模型回的文常这样排版）', () => {
    expect(matchShelf('「东方树叶 青柑普洱」值得一试').length, '带空格与书名号就没命中 ⇒ norm() 没起作用').toBeGreaterThan(0)
  })

  it('反向半边：答案没提任何商品 ⇒ 零命中（组件据此整块不渲染，不摆空货架）', () => {
    expect(matchShelf('我们工作日 17:37 到 23:00 营业。')).toEqual([])
    expect(matchShelf('')).toEqual([])
  })

  it('上限三件：聊天气泡里排一排卡片，超过就把对话挤没了', () => {
    const many = matchShelf('东方树叶青柑普洱 和其正凉茶 康师傅绿茶 康师傅冰红茶 茶π 都可以')
    expect(many.length).toBeLessThanOrEqual(3)
  })
})
