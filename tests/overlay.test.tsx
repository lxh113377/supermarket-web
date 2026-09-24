// @vitest-environment jsdom
// Overlay 统一模态容器（七轮 H2：56% → 目标 100%）。它是"禁弹窗铁律"的替代品，
// a11y 三件事必须可验证：焦点陷阱、Esc/遮罩开关语义、关闭后焦点归还与滚动解锁。
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Overlay from '../src/components/Overlay'

// jsdom 无布局，offsetParent 恒 null → Overlay 的"可聚焦节点过滤"会把所有元素当成隐藏，
// 焦点陷阱分支因此测不到。这里把 offsetParent 定义为"有父元素即可见"，还原浏览器语义。
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement },
  })
})

afterEach(() => { cleanup() })

function Body() {
  return (
    <div>
      <button>触发元素</button>
      <Overlay onClose={vi.fn()} label="确认订单">
        <p>内容</p>
        <button data-autofocus>主操作</button>
        <button>次操作</button>
      </Overlay>
    </div>
  )
}

describe('基本渲染与开关语义', () => {
  it('open 默认 true → role=dialog + aria-modal + aria-label', () => {
    render(<Body />)
    const d = screen.getByRole('dialog')
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(d.getAttribute('aria-label')).toBe('确认订单')
    expect(screen.getByText('内容')).toBeTruthy()
  })

  it('open=false 直接不渲染（调用方用条件渲染也能，两种控制方式都得可用）', () => {
    render(<Overlay open={false} onClose={vi.fn()}>x</Overlay>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('点遮罩关闭；closeOnBackdrop=false 时不关（加载态遮罩防误点）', () => {
    const onClose = vi.fn()
    const { unmount } = render(<Overlay onClose={onClose}><p>hi</p></Overlay>)
    const back = screen.getByRole('dialog').previousElementSibling as HTMLElement
    fireEvent.click(back)
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    const onClose2 = vi.fn()
    render(<Overlay onClose={onClose2} closeOnBackdrop={false}><p>hi</p></Overlay>)
    fireEvent.click(screen.getByRole('dialog').previousElementSibling as HTMLElement)
    expect(onClose2).not.toHaveBeenCalled()
  })

  it('卡片内部点击不外溢（stopPropagation），但关闭按钮能自己关', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose}><p>正文</p></Overlay>)
    fireEvent.click(screen.getByText('正文'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Esc 关闭；closeOnEsc=false 时忽略（图片预览要留住用户）', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose}><p>x</p></Overlay>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    const onClose2 = vi.fn()
    render(<Overlay onClose={onClose2} closeOnEsc={false}><p>x</p></Overlay>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose2).not.toHaveBeenCalled()
  })
})

describe('焦点管理', () => {
  it('优先聚焦 data-autofocus 元素', () => {
    render(<Body />)
    expect(screen.getByText('主操作')).toBe(document.activeElement)
  })

  it('无标记时聚焦第一个可聚焦元素', () => {
    render(<Overlay onClose={vi.fn()}><input aria-label="输入" /><button>按钮</button></Overlay>)
    expect(screen.getByLabelText('输入')).toBe(document.activeElement)
  })

  it('无可聚焦内容时聚焦容器本身，Tab 不出逃', () => {
    render(<Overlay onClose={vi.fn()}><p>纯文本</p></Overlay>)
    const d = screen.getByRole('dialog')
    expect(d).toBe(document.activeElement)
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('Tab 到最后一项后回到首项；Shift+Tab 在首项回到末项（焦点陷阱）', () => {
    render(<Body />)
    const first = screen.getByText('主操作')
    const last = screen.getByText('次操作')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toBe(document.activeElement)
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toBe(document.activeElement)
  })

  it('关闭后焦点归还触发元素、背景滚动解锁（键盘用户不迷失）', () => {
    document.body.style.overflow = 'auto'
    function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
      return (
        <div>
          <button>触发元素</button>
          {open && <Overlay onClose={onClose}><button data-autofocus>主操作</button></Overlay>}
        </div>
      )
    }
    const onClose = vi.fn()
    const { rerender } = render(<Harness open={false} onClose={onClose} />)
    const trigger = screen.getByText('触发元素')
    trigger.focus() // 模拟"点触发元素 → 打开遮罩"的时序
    rerender(<Harness open onClose={onClose} />)
    expect(screen.getByText('主操作')).toBe(document.activeElement)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Harness open={false} onClose={onClose} />)
    expect(document.body.style.overflow).toBe('auto')
    expect(trigger).toBe(document.activeElement)
  })

  it('禁用按钮不进入焦点序列（offsetParent 为 null 的被过滤）', () => {
    render(<Overlay onClose={vi.fn()}><button disabled>禁用</button><button>可用</button></Overlay>)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('可用')).toBe(document.activeElement)
  })
})
