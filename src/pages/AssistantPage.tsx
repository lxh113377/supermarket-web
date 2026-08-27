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

  return (
    <div className="flex flex-col h-full min-h-screen bg-surface">
      {/* 返回栏 */}
      <div className="flex items-center px-4 py-2.5 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <button
          onClick={() => navigate(-1)}
          aria-label="返回"
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200"
        >
          ←
        </button>
        <span className="ml-2 text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          <IconRobot className="w-4 h-4 text-brand-600" />
          AI 导购助手
        </span>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full brand-bar opacity-90 shrink-0 flex items-center justify-center text-white mt-0.5">
                <IconRobot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`max-w-[78%] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line rounded-2xl animate-slide-down ${
                m.role === 'user'
                  ? 'bg-gray-900 text-white rounded-br-md'
                  : m.isError
                    ? 'bg-red-50 text-red-500 border border-red-100 rounded-bl-md'
                    : 'bg-white border border-gray-100/80 shadow-card text-gray-700 rounded-bl-md'
              }`}
            >
              {m.text}
              {m.isError && (
                <button
                  onClick={() => void send(lastRetryRef.current)}
                  disabled={pending}
                  className="mt-2 text-xs font-semibold text-brand-600 underline underline-offset-2 disabled:opacity-50"
                >
                  重试
                </button>
              )}
            </div>
          </div>
        ))}

        {/* 快捷问题 chips（仅开场展示） */}
        {messages.length <= 1 && !pending && (
          <div className="flex flex-wrap gap-2 pt-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => void send(q)}
                className="px-3 py-1.5 rounded-full bg-white border border-gray-200 text-xs text-gray-600 hover:border-brand-300 hover:text-brand-600 transition-colors duration-150"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* 输入中指示器 */}
        {pending && (
          <div className="flex gap-2 justify-start">
            <div className="w-7 h-7 rounded-full brand-bar opacity-90 shrink-0 flex items-center justify-center text-white mt-0.5">
              <IconRobot className="w-4 h-4" />
            </div>
            <div className="bg-white border border-gray-100/80 shadow-card rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <form
        onSubmit={onSubmit}
        className="border-t border-gray-100 bg-white/95 backdrop-blur-sm px-4 py-3 safe-bottom flex items-center gap-2"
      >
        <input
          type="text"
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
          className="w-11 h-11 shrink-0 rounded-full brand-bar text-white flex items-center justify-center shadow-soft transition-all duration-200 active:scale-[0.94] disabled:opacity-40 disabled:pointer-events-none"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m22 2-7 20-4-9-9-4 20-7Z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      </form>
    </div>
  )
}