/**
 * Accessibility static rules - pure functions, zero dependencies (round 75, I-75-5).
 *
 * Grounded in this repo's real shape, not in theory:
 *   - src has 11 <label> and only 6 htmlFor; 14 <img>, 2 of them decorative alt="" (legal).
 *   - No machine gate has ever looked at 'does this control have an accessible name'.
 *   - Peers: saleor uses @axe-core/playwright, medusa uses jsx-a11y style rules. This repo
 *     deliberately does not pull axe (~1MB + noisy snapshots); instead it keeps a small
 *     explainable rule set where every rule is driven by a real defect shape here.
 *
 * Division of labour (do not mix them):
 *   this file       = static rules (source-level, no browser, runs in vitest + npm run verify)
 *   tests/e2e-visual = real-browser visibility/focusability (facts that need CSS applied)
 */

/** Allowed exception faces. Each entry needs a falsifiable reason (global rule R5). */
export const ALLOWED = [
  {
    id: 'decorative-alt',
    why: 'A purely decorative image (icon / separator / placeholder thumbnail) with an explicit empty alt is the CORRECT form: screen readers should skip it. The rule therefore treats alt="" as legal rather than as a missing alt.'
  },
];

const VISIBLE_INPUT = /<input\b(?![^>]*\btype\s*=\s*['"]hidden['"])/g;

/**
 * Rule 1: every <img> must carry an alt attribute (empty string allowed, see ALLOWED[0]).
 * Why it matters: with no alt the screen reader reads the FILE NAME (e.g. 4.webp),
 * which is worse than silence - product images here are named /images/<order>.webp.
 */
export function checkImgAlt(source) {
  const problems = [];
  for (const m of String(source).matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    if (!/\balt\s*=/.test(tag)) {
      const line = String(source).slice(0, m.index).split('\n').length;
      problems.push({ rule: 'img-alt', line, detail: 'img has no alt (screen reader will read the file name): ' + tag.replace(/\s+/g, ' ').slice(0, 90) });
    }
  }
  return problems;
}

/**
 * Rule 2: every visible <input> needs an accessible name - aria-label / aria-labelledby / id+htmlFor.
 * Repo shape: the quantity box uses aria-label (good). The trap is relying on placeholder only,
 * because placeholder does not participate in accessible-name computation.
 */
/**
 * Read one complete JSX opening tag starting at `start` (balanced braces included).
 * First version cut at the first '>' - which sits inside aria-label={...} - so a *correct*
 * element was reported as a violation. A judge that manufactures false positives is worse
 * than no judge: it teaches the next reader to ignore it.
 */
export function readJsxTag(text, start) {
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    const c = text[i]
    if (c === '{') { depth += 1; continue }
    if (c === '}') { depth = Math.max(0, depth - 1); continue }
    if (c === '>' && depth === 0) return text.slice(start, i + 1)
  }
  return text.slice(start)
}

export function checkInputName(source) {
  const problems = [];
  const text = String(source);
  // htmlFor 既可能是字符串也可能是模板串：htmlFor={`sf-${field.key}`} 与 id={`sf-${field.key}`}
  // 是同一个表达式 ⇒ 按"去掉反引号与 ${}"后的形状比对，而不是只认引号字面量。
  const normalizeId = (s) => String(s)
    .replace(/\$\{\s*([^}]+?)\s*\}/g, (_, e) => String(e).trim())
    .replace(/[`{}]/g, '')
    .trim()
  // 两种写法都要认：attr="literal" 与 attr={`template`}。一处写宽一处写窄，
  // 就会造成「id 认得出、htmlFor 认不出」（或反过来）的假阳性 —— 本轮真实踩到过。
  const ATTR_RE = (name) => new RegExp(name + '\\s*=\\s*\\{?\\s*([\'"])([^\'"]+)\\1|' + name + '\\s*=\\s*\\{\\s*`([^`]+)`\\s*\\}', 'g')
  const attrValues = (attr) => [...text.matchAll(ATTR_RE(attr))].map((m) => normalizeId(m[2] || m[3] || ''))
  const htmlForIds = new Set(attrValues('htmlFor'));
  for (const m of text.matchAll(VISIBLE_INPUT)) {
    const start = m.index;
    const tag = readJsxTag(text, start);
    // 包在 <label>...</label> 里的控件天然有可访问名字（隐含 label）—— 本仓 PrintForm 正是这种写法，
    // 不认它就会把三个**正确**的输入框报成违规，那正是"会误报的尺下一轮被消音"的形状。
    const hasWrapperLabel = isInsideLabel(text, start)
    const hasAria = /aria-label\s*=|aria-labelledby\s*=/.test(tag);
    // 只看**这一个标签内部**的 id：用与 htmlFor 同一套两形态正则，避免一侧认得出另一侧认不出
    const idRaw = [...tag.matchAll(ATTR_RE('id'))][0]
    const id = idRaw ? normalizeId(idRaw[2] || idRaw[3] || '') : undefined
    const hasFor = id && htmlForIds.has(id);
    if (!hasAria && !hasFor && !hasWrapperLabel) {
      const line = text.slice(0, start).split('\n').length;
      problems.push({ rule: 'input-name', line, detail: 'visible input has no accessible name (placeholder does not count): ' + tag.replace(/\s+/g, ' ').slice(0, 90) });
    }
  }
  return problems;
}

/**
 * Rule 3: clickable non-button elements need role + keyboard semantics.
 * Only the most dangerous shape is caught: <div onClick / <span onClick without role/tabIndex/onKeyDown.
 * A broader rule would false-positive on event delegation and third-party injection; a gate that
 * cries wolf gets muted next round, which is worse than a narrow rule that always means something.
 */
export function checkClickableSemantics(source) {
  const problems = [];
  for (const m of String(source).matchAll(/<(div|span)\b[^>]*\bonClick\s*=[^>]*>/g)) {
    const tag = m[0];
    if (/\brole\s*=/.test(tag) || /\btabIndex\s*=/.test(tag) || /\bonKeyDown\s*=/.test(tag)) continue;
    // role="presentation" 是**显式声明"我不是控件"**：鼠标便利面（如点遮罩关闭）用它，
    // 键盘等价路径必须另有实现（本仓 Overlay 的 Escape 分支）。没这句就是真违规。
    // 关闭遮罩：`aria-hidden="true"` 或 role="presentation" 明确声明"它不是可交互控件"，
    // 键盘可达性由同组件的 Escape 分支负责（本仓 Overlay 正是这个形态）。
    // 这类例外必须有源码里的**显式声明**，不能靠"它看起来像遮罩"来豁免。
    if (/aria-hidden\s*=\s*["'{]\s*(?:true|\{?true)/.test(tag) || /role\s*=\s*["']presentation["']/.test(tag)) continue;
    const line = String(source).slice(0, m.index).split('\n').length;
    problems.push({ rule: 'clickable-semantics', line, detail: '<' + m[1] + ' onClick> without role/tabIndex/onKeyDown => keyboard users cannot reach it: ' + tag.replace(/\s+/g, ' ').slice(0, 90) });
  }
  return problems;
}

/** Aggregate: feed a { filepath: source } map, get every finding tagged with the file. */
export function auditSources(sources) {
  const out = [];
  for (const [file, src] of Object.entries(sources || {})) {
    for (const p of checkImgAlt(src)) out.push({ file, ...p });
    for (const p of checkInputName(src)) out.push({ file, ...p });
    for (const p of checkClickableSemantics(src)) out.push({ file, ...p });
  }
  return out;
}

/** 判断某位置是否落在 <label ...> ... </label> 之间（隐含标签）。 */
export function isInsideLabel(text, index) {
  const before = text.slice(0, index)
  const open = before.lastIndexOf('<label')
  if (open < 0) return false
  const close = before.lastIndexOf('</label>')
  return close < open
}
