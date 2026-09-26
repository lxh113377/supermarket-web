import { hasAvailableCombo, type Selection, type VariantAxis, type VariantGroup } from '../../utils/variants'

// 变体选择器（口味 / 包装 / 容量）
//
// 轴名按真实属性写（口味、包装、容量），不硬套「颜色」字样；kind==='color' 的轴
// 用色块选择器呈现（包装主色示意），真实属性以旁边的文字为准 —— 色块只是辨识辅助，
// 不让颜色单独承载语义（色觉障碍用户仍能从文字区分）。
//
// 可访问性：每轴一个 <fieldset>+<legend>（读屏播报轴名），选项是带 aria-pressed 的
// <button>（不是 radio，因为选项会因组合售罄而动态禁用，button+pressed 语义更稳），
// 焦点环走全局 :focus-visible。

interface Props {
  group: VariantGroup
  selection: Selection
  /** 用户点了某轴某项；页面负责用 pickCombo 归一并回写 selection */
  onChange: (axisId: string, optionId: string) => void
  /** 归一后若有其他轴被自动改动，页面把这句话传进来，用 aria-live 如实播报 */
  autoAdjustNote?: string
}

function AxisRow({ axis, group, selection, onChange }: {
  axis: VariantAxis
  group: VariantGroup
  selection: Selection
  onChange: Props['onChange']
}) {
  const current = selection[axis.id] ?? ''
  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="text-xs font-semibold text-gray-500 mb-2 px-0">
        {axis.name}
        {current === '' && (
          <span className="ml-2 font-normal text-gray-400">当前组合不含此选项</span>
        )}
      </legend>
      <div className="flex flex-wrap gap-2">
        {axis.options.map((opt) => {
          const selected = current === opt.id
          // 只灰掉「全组任何可售组合都不含它」的真死选项；
          // 与当前其他轴凑不出组合的选项保持可点 —— 点了由 pickCombo 自动归一，
          // 比直接禁用更符合真实电商行为（禁用会让用户以为该规格整体缺货）。
          const dead = !hasAvailableCombo(group, axis.id, opt.id)
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(axis.id, opt.id)}
              disabled={dead}
              aria-pressed={selected}
              title={dead ? `${opt.label}（暂无可售组合）` : opt.label}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all duration-200
                focus-visible:outline-2 focus-visible:outline-brand-500 active:scale-[0.97]
                ${selected
                  ? 'border-brand-500 bg-brand-50 text-brand-800 font-semibold shadow-soft'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300 hover:text-brand-700'}
                ${dead ? 'opacity-40 line-through cursor-not-allowed' : ''}`}
            >
              <span>{opt.label}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export default function VariantPicker({ group, selection, onChange, autoAdjustNote }: Props) {
  return (
    <div className="space-y-4">
      {group.axes.map((axis) => (
        <AxisRow key={axis.id} axis={axis} group={group} selection={selection} onChange={onChange} />
      ))}
      {/* 自动归一播报：如「盒装无 500ml，已切到 250ml」——不静默改用户的规格 */}
      {autoAdjustNote && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200/70 rounded-lg px-3 py-2" role="status" aria-live="polite">
          {autoAdjustNote}
        </p>
      )}
      {group.disclosure && (
        <p className="text-[11px] leading-relaxed text-gray-400 border-t border-gray-100 pt-3">
          <span className="font-semibold text-gray-500">数据说明：</span>
          {group.disclosure}
        </p>
      )}
    </div>
  )
}
