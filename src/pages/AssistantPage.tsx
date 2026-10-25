import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { publicCall } from '../auth'
import { IconRobot } from '../components/Icons'
import { ASSISTANT_GREETING, SUGGESTED_QUESTIONS, ASSISTANT_CONVERSATION_KEY } from '../data/assistantFaq'

interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  text: string
  isError?: boolean
}

function getConvoId(): string {
  try {
    return localStorage.getItem(ASSISTANT_CONVERSATION_KEY) || ''
  } catch {
    return ''
  }
}

function setConvoId(id: string) {
  try {
    localStorage.setItem(ASSISTANT_CONVERSATION_KEY, id)
  } catch {
    /* 私隐模式等写入失败可忽略 */
  }
}

let msgSeq = 0
const nextId = () => ++msgSeq

export default function AssistantPage() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: nextId(), role: 'assistant', text: ASSISTANT_GREETING },
  ])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastRetryRef = useRef('')

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
  }
  useEffect(scrollToBottom, [messages, pending])

  const send = async (raw: string) => {
    const question = raw.trim()
    if (!question || pending) return
    setInput('')
    lastRetryRef.current = question
    const userMsg: ChatMsg = { id: nextId(), role: 'user', text: question }
    setMessages((prev) => [...prev, userMsg])
    setPending(true)
    try {
      const data = await publicCall<{ content: string; source: string; conversationId?: string }>('aiChat', { question, conversationId: getConvoId() })
      if (data.code === 0 && data.data) {
        const content = String(data.data.content || '').trim()
        // 降级铁律（F38）：source=dify-error 时后端已回脱敏文案，前端直接展示降级提示
        const isError = data.data.source === 'dify-error' || !content
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', text: isError ? 'AI 服务暂不可用，已切换为演示模式，请稍后重试。' : content, isError },
        ])
        if (data.data.conversationId) setConvoId(String(data.data.conversationId))
      } else {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', text: data.message || '服务暂时不可用，请稍后重试', isError: true },
        ])
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', text: '网络开小差了，请检查网络后重试', isError: true },
      ])
    } finally {
      setPending(false)
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  /**
   * 空态：只有开场白、且 AI 没在回复。
   * 这个判断同时决定两件事 —— 快捷问题是否展示、消息区是否垂直居中，
   * 所以提成一个变量而不是在两处各写一遍（两处各写迟早会漂成不同的条件）。
   */
  const isEmptyState = messages.length <= 1 && !pending

  return (
    <div role="main" id="main-content" tabIndex={-1} className="flex flex-col h-full min-h-screen bg-surface">
      {/* 返回栏 */}
      <div className="flex items-center px-4 py-2.5 bg-panel/95 backdrop-blur-sm border-b border-gray-100">
        <button
          onClick={() => navigate(-1)}
          aria-label="返回"
          className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-700 hover:bg-gray-100 transition duration-200 active:scale-90"
        >
          ←
        </button>
        <h1 className="ml-2 flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
          <IconRobot className="w-4 h-4 text-brand-300" />
          AI 导购助手
        </h1>
              </div>

      {/* 消息区：role="log" + aria-live 让读屏在 AI 回复到达时自动播报新消息
          （原实现是纯视觉流，读屏用户完全感知不到回复已到） */}
      {/*
       * 空态垂直居中（2026-10-24 修「首屏 59%~72% 是空洞」）。
       * 实测三档视口的 chips 底 → 输入框顶：手机 497px / 桌面 614px / 平板 738px，
       * 也就是首屏过半是空白 —— 而这条页是 AI 导购的入口，空态就是它的门面。
       *
       * 做法是把内容包一层内层容器，只在空态给它 min-h-full + justify-center：
       *   ① 外层必须原样保留 flex-1 overflow-y-auto —— touch-targets / press-feedback /
       *      warm-foreground 三条判据都按「overflow-y 是 auto|scroll 且内容超高」找滚动容器
       *      （layout.spec.ts 也直接 querySelector('#root .overflow-y-auto')），改类名会打断它们；
       *   ② 居中放在**内层**而不是给外层加 justify-center：外层是滚动容器，
       *      直接 justify-center 在内容超过一屏时会把顶部裁成不可达（经典 flex 陷阱）；
       *      内层用 min-h-full 则内容一长就撑高自己、自由空间归零，不会裁顶。
       *   ③ 非空态不加居中（保持原有 space-y-3 正常流），因为聊天一旦有内容就该贴顶往下长。
       */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="对话记录"
        className="flex-1 overflow-y-auto w-full"
      >
        {/* 间距用 gap-3 而不是 space-y-3：两态都是 flex 容器，gap 在居中态同样生效
            （space-y 只在非居中分支会给，空态就会丢掉 greeting 与 chips 的间距）。 */}
        <div className={'mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 pb-4 ' + (isEmptyState ? 'min-h-full justify-center' : '')}>
        {/* 柜员灯牌：AI 在线状态（呼吸点 = 全站营业状态同一语言），空态时它是门面的一部分 */}
        {isEmptyState && (
          <div className="clerk-plate" aria-hidden="true">
            <i />
            <span>Assistant on duty</span>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="bot-socket bg-brand-500 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink">
                <IconRobot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`max-w-[78%] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line rounded-2xl animate-slide-down ${
                m.role === 'user'
                  ? 'bg-espresso text-cream rounded-br-md'
                  : m.isError
                    ? 'bg-red-50 text-red-700 border border-red-100 rounded-bl-md'
                    : 'bg-panel border border-gray-100/80 shadow-card text-stone-700 rounded-bl-md'
              }`}
            >
              {m.text}
              {m.isError && (
                <button
                  onClick={() => void send(lastRetryRef.current)}
                  disabled={pending}
                  className="mt-2 text-xs font-semibold text-brand-300 underline underline-offset-2 disabled:opacity-50"
                >
                  重试
                </button>
              )}
            </div>
          </div>
        ))}

        {/* 快捷问题 chips（仅开场展示，条件与居中同一个 isEmptyState） */}
        {isEmptyState && (
          <div className="flex flex-wrap gap-2 pt-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => void send(q)}
                className="px-3 py-1.5 rounded-full bg-panel border border-gray-200 text-xs text-stone-600 hover:border-brand-500 hover:text-brand-300 transition duration-150 active:scale-[0.98]"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* 输入中指示器 */}
        {pending && (
          <div className="flex gap-2 justify-start" role="status" aria-label="AI 正在输入">
            <div className="bg-brand-500 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink">
              <IconRobot className="w-4 h-4" />
            </div>
            <div className="bg-panel border border-gray-100/80 shadow-card rounded-2xl rounded-bl-md px-4 py-3">
              <span className="typing-dots" aria-hidden="true">
                <i className="wait-pulse" />
                <i className="wait-pulse" style={{ animationDelay: '400ms' }} />
                <i className="wait-pulse" style={{ animationDelay: '800ms' }} />
              </span>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* 输入区 */}
      <form
        onSubmit={onSubmit}
        className="border-t border-gray-100 bg-panel/95 backdrop-blur-sm px-4 py-3 safe-bottom"
      >
        <div className="flex items-center gap-2 w-full max-w-3xl mx-auto">
        <input
          type="text"
          aria-label="向 AI 导购提问"
          className="input-base flex-1"
          placeholder="问问营业时间、配送、商品…（200字内）"
          maxLength={200}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          aria-label="发送"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-500 text-espresso shadow-brand transition duration-200 hover:bg-brass active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m22 2-7 20-4-9-9-4 20-7Z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
        </div>
      </form>
    </div>
  )
}
