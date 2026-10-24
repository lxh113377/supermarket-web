// @vitest-environment jsdom
/**
 * 无字段服务（snacks）不得渲染「填写信息 / 提交信息」这一承诺（2026-10-24 立项）。
 *
 * 一手缺陷（浏览器实测，不是推断）：snacks 的 type 是 supermarket、没有 fields
 * （它的正确入口是商城加购下单，CategoryPage 也确实把它导向 /shop），但 ServiceFormPage
 * 照旧渲染「📝 填写信息」标题 + 「提交信息 →」按钮，中间**零个输入框**。而 validate()
 * 遍历的是 service.fields || [] ⇒ 零字段时循环不执行、校验恒真。实测点一次提交就往
 * sm_submissions 写进 {serviceId:snacks, formData:{}, status:pending} 一条空工单，页面
 * 还回「提交成功，请耐心等待工作人员联系」⇒ 商家收到一条没有内容的工单、顾客在等
 * 一个永远不来的回复。这是数据完整性 + 界面撒谎，不是样式问题。
 *
 * 为什么这个缺陷能活到现在：全仓没有任何一条测试断过 snacks 这页（本轮 grep 实测：
 * 出现「填写信息」的测试只有 contrast 的 service-form 路由，而它走的是**有 5 个字段**
 * 的 delivery ⇒ 无字段分支从未被执行过）。
 *
 * 夹具口径（照 serviceFormPage.test.tsx 的既有做法）：不触网，createSubmission 全 mock；
 * 营业时间 mock 成营业中，免得打烊提示混进断言。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  createSubmission: vi.fn(),
  navigate: vi.fn(),
  serviceId: { current: 'snacks' },
}))

vi.mock('../src/db', () => ({ createSubmission: mocks.createSubmission }))
vi.mock('../src/utils/businessHours', () => ({
  isBusinessHours: () => true,
  getClosedMessage: () => '当前非营业时间',
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => ({ serviceId: mocks.serviceId.current }),
  }
})

import ServiceFormPage from '../src/pages/ServiceFormPage'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.serviceId.current = 'snacks'
  mocks.createSubmission.mockResolvedValue({ id: 'sub-1' })
})

describe('无字段服务不得承诺填表', () => {
  it('snacks：标题说「怎么下单」，不出现「填写信息」', () => {
    render(<ServiceFormPage />)
    expect(screen.getByRole('heading', { name: '怎么下单' })).toBeTruthy()
    expect(screen.queryByText('填写信息'), '零输入框却写着「填写信息」= 界面撒谎').toBeNull()
  })

  it('snacks：不给「提交信息」入口，只给「去商城下单」出口', () => {
    render(<ServiceFormPage />)
    expect(screen.queryByRole('button', { name: /提交信息/ }), '留着提交入口就能写出空工单').toBeNull()
    expect(screen.getByRole('button', { name: /去商城下单/ })).toBeTruthy()
  })

  it('出口按钮走导航：目标 /shop 且带 fromCategory（与 CategoryPage 同一口径）', () => {
    render(<ServiceFormPage />)
    fireEvent.click(screen.getByRole('button', { name: /去商城下单/ }))
    // fromCategory 不是装饰：CustomerPage 靠它决定返回键是 navigate(-1) 还是弹回首页
    expect(mocks.navigate).toHaveBeenCalledWith('/shop', { state: { fromCategory: true } })
  })

  it('点到底也不产生提交：createSubmission 一次都不被调用、localStorage 无工单', async () => {
    render(<ServiceFormPage />)
    fireEvent.click(screen.getByRole('button', { name: /去商城下单/ }))
    await new Promise((r) => setTimeout(r, 50))
    expect(mocks.createSubmission).not.toHaveBeenCalled()
    expect(localStorage.getItem('sm_submissions'), '写出了空工单').toBeNull()
  })

  it('底部不再承诺「提交后请耐心等待工作人员联系」（那件事不会发生）', () => {
    render(<ServiceFormPage />)
    expect(screen.queryByText(/提交后请耐心等待/)).toBeNull()
    expect(screen.getByText(/在商城里挑商品/)).toBeTruthy()
  })

  it('对照：有字段的服务（delivery）完全不受影响 —— 仍填表、仍可提交', async () => {
    mocks.serviceId.current = 'delivery'
    render(<ServiceFormPage />)
    expect(screen.getByRole('heading', { name: '填写信息' })).toBeTruthy()
    const btn = screen.getByRole('button', { name: /提交信息/ })
    expect(btn).toBeTruthy()
    // 必填项拦住（证明 validate 真的在管字段，不是恒真）
    fireEvent.click(btn)
    await waitFor(() => expect(mocks.createSubmission).not.toHaveBeenCalled())
  })
})
