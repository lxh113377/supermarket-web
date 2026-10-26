
// 服务说明卡片（M6 拆分自 ServiceFormPage，2026-09-05）
import GlyphIcon from '../brand/GlyphIcon'
// hint 文本按空行分段，标题行（括号包裹）、价格行高亮；渲染逻辑与拆分前逐字一致。

function parseHintSections(hint?: string): string[][] {
  if (!hint) return []
  return hint.split('\n\n').map(section => {
    const lines = section.split('\n').filter(l => l.trim())
    return lines
  })
}

export default function ServiceHintCard({ hint }: { hint?: string }) {
  const hintSections = parseHintSections(hint)
  if (hintSections.length === 0) return null
  return (
    <div className="bg-panel rounded-3xl p-5 mb-4 shadow-card border border-gray-100/80 animate-fade-in-up stagger-1">
      <div className="flex items-center gap-2 mb-3.5">
        <span className="hint-plate"><GlyphIcon glyph="📋" /></span>
        <h2 className="text-sm font-semibold text-ink-soft">服务说明</h2>
      </div>
      <div className="space-y-3">
        {hintSections.map((section, sIdx) => (
          <div key={sIdx}>
            {sIdx > 0 && <div className="border-t border-dashed border-gray-100 my-3" />}
            <div className="space-y-1.5">
              {section.map((line, lIdx) => {
                // 检测是否是标题行（如"(配套服务)"）
                const isTitle = line.startsWith('(') || line.startsWith('（')
                if (isTitle) {
                  return (
                    <p key={lIdx} className="text-xs font-semibold text-brand-300 mt-2 flex items-center gap-1.5">
                      <span className="w-1 h-3 rounded-full bg-brass inline-block" />
                      {line.replace(/[()（）]/g, '')}
                    </p>
                  )
                }
                // 检测是否含价格信息
                const hasPrice = /\d+元/.test(line) || /\d+\.\d+元/.test(line)
                return (
                  <p key={lIdx} className={`text-xs leading-relaxed flex items-start gap-2 ${hasPrice ? 'text-ink-soft font-medium' : 'text-stone-500'}`}>
                    <span className={`mt-1 w-1 h-1 rounded-full flex-shrink-0 ${hasPrice ? 'bg-brass' : 'bg-gray-300'}`} />
                    {line}
                  </p>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
