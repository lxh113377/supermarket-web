// AI 导购知识：引导语 + 建议问题
// 注意：规则版实际回复在 functions/lib/dify.js（RULE_FAQ），改动需两侧同步；
// 本文件只承载前端引导语与快捷问题 chips（发送后由后端回答）。

export const ASSISTANT_GREETING =
  '你好呀～我是「江科一站通」智能助手，可以问商品推荐、营业时间、配送和支付等问题，也可以让我推荐解渴小零食～'

export const SUGGESTED_QUESTIONS = [
  '你们几点营业？',
  '怎么付款，支持微信吗？',
  '多久能送到？',
  '买错了能退吗？',
  '天气这么热，推荐点解渴的',
]

// 会话 ID 持久化键（多轮上下文）
export const ASSISTANT_CONVERSATION_KEY = 'sm_ai_conversation'