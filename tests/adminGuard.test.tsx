// @vitest-environment jsdom
// AdminGuard 管理端登录闸（七轮 H2，原覆盖 0%）：整个后台的唯一入口。
// 锁：演示模式直通、刷新后用会话内密钥自动续登（三条结果分支）、错钥/网络异常的文案区分、
// 以及"验证中"期间的重复提交保护。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import AdminGuard from '../src/components/AdminGuard'

const m = vi.hoisted(() => ({ cloud: true, loginAdmin: vi.fn(), verifyAdminKey: vi.fn() }))

vi.mock('../src/cloudbase', () => ({ get IS_CLOUD() { return m.cloud } }))
vi.mock('../src/auth', () => ({ loginAdmin: m.loginAdmin, verifyAdminKey: m.verifyAdminKey }))

const Child = () => <div>后台内容</div>
const input = () => screen.getByLabelText('管理密钥') as HTMLInputElement

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  m.cloud = true
})
afterEach(() => { cleanup() })

describe('演示模式直通', () => {
  it('IS_CLOUD=false 时不拦（本地演示无需密钥），也不碰会话存储', () => {
    m.cloud = false
    render(<AdminGuard><Child /></AdminGuard>)
    expect(screen.getByText('后台内容')).toBeTruthy()
    expect(screen.queryByLabelText('管理密钥')).toBeNull()
  })
})

describe('会话续登', () => {
  it('会话里有密钥 → 校验通过直接进后台（不再要求手输）', async () => {
    sessionStorage.setItem('sm_admin_key', 'cached-key')
    m.verifyAdminKey.mockResolvedValue(true)
    render(<AdminGuard><Child /></AdminGuard>)
    await waitFor(() => expect(screen.getByText('后台内容')).toBeTruthy())
    expect(m.verifyAdminKey).toHaveBeenCalledWith('cached-key')
    expect(screen.queryByLabelText('管理密钥')).toBeNull()
  })

  it('续登失败（密钥已换）→ 回到输入态，不自动进后台', async () => {
    sessionStorage.setItem('sm_admin_key', 'stale-key')
    m.verifyAdminKey.mockResolvedValue(false)
    render(<AdminGuard><Child /></AdminGuard>)
    await waitFor(() => expect(screen.getByLabelText('管理密钥')).toBeTruthy())
    expect(screen.queryByText('后台内容')).toBeNull()
  })

  it('续登请求抛错 → 兜底回输入态（不卡死在"验证中"）', async () => {
    sessionStorage.setItem('sm_admin_key', 'x')
    m.verifyAdminKey.mockRejectedValue(new Error('offline'))
    render(<AdminGuard><Child /></AdminGuard>)
    await waitFor(() => expect(screen.getByLabelText('管理密钥')).toBeTruthy())
    expect(screen.queryByText('验证中...')).toBeNull()
  })

  it('会话里没有密钥 → 直接给输入框，不发校验请求', async () => {
    render(<AdminGuard><Child /></AdminGuard>)
    expect(screen.getByLabelText('管理密钥')).toBeTruthy()
    expect(m.verifyAdminKey).not.toHaveBeenCalled()
  })
})

describe('手工登录', () => {
  it('空密钥提交只做本地校验，不发请求', async () => {
    render(<AdminGuard><Child /></AdminGuard>)
    fireEvent.click(screen.getByRole('button', { name: '进入后台' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('请输入管理密钥'))
    expect(m.loginAdmin).not.toHaveBeenCalled()
  })

  it('纯空格也算空（防"看起来填了其实没填"）', async () => {
    render(<AdminGuard><Child /></AdminGuard>)
    fireEvent.change(input(), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '进入后台' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('请输入管理密钥'))
    expect(m.loginAdmin).not.toHaveBeenCalled()
  })

  it('密钥正确 → 进入后台；提交前 trim 掉首尾空格', async () => {
    m.loginAdmin.mockResolvedValue(true)
    render(<AdminGuard><Child /></AdminGuard>)
    fireEvent.change(input(), { target: { value: '  secret-key  ' } })
    fireEvent.click(screen.getByRole('button', { name: '进入后台' }))
    await waitFor(() => expect(m.loginAdmin).toHaveBeenCalledWith('secret-key'))
    await waitFor(() => expect(screen.getByText('后台内容')).toBeTruthy())
  })

  it('密钥错误 → 「密钥错误」；接口异常 → 「验证失败：原因」（两种失败必须可区分）', async () => {
    m.loginAdmin.mockResolvedValue(false)
    const { unmount } = render(<AdminGuard><Child /></AdminGuard>)
    fireEvent.change(input(), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '进入后台' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('密钥错误'))
    expect(screen.queryByText('后台内容')).toBeNull()
    unmount()

    m.loginAdmin.mockRejectedValue(new Error('网络错误'))
    render(<AdminGuard><Child /></AdminGuard>)
    fireEvent.change(input(), { target: { value: 'any' } })
    fireEvent.click(screen.getByRole('button', { name: '进入后台' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('验证失败：网络错误'))
  })

  it('Enter 等价于点按钮（手机端键盘提交）', async () => {
    m.loginAdmin.mockResolvedValue(true)
    render(<AdminGuard><Child /></AdminGuard>)
    fireEvent.change(input(), { target: { value: 'k' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(m.loginAdmin).toHaveBeenCalledWith('k'))
  })

  it('请求进行中整页切到"验证中"态（表单卸载＝天然防连点），完成后进入后台', async () => {
    let resolveFn: (v: boolean) => void = () => undefined
    m.loginAdmin.mockReturnValue(new Promise((r) => { resolveFn = r }))
    render(<AdminGuard><Child /></AdminGuard>)
    fireEvent.change(input(), { target: { value: 'k' } })
    fireEvent.click(screen.getByRole('button', { name: '进入后台' }))
    expect(screen.getByRole('status').textContent).toBe('验证中...')
    expect(screen.queryByRole('button', { name: '进入后台' })).toBeNull() // 表单已卸载，点不到第二次
    expect(m.loginAdmin).toHaveBeenCalledTimes(1)
    resolveFn(true)
    await waitFor(() => expect(screen.getByText('后台内容')).toBeTruthy())
  })
})
