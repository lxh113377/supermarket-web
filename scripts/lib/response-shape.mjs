// 响应形状签名（第二十七轮）：verify-backend 的录制点与本仓判据 `api-response-contract.mjs`
// 共用这一件 —— 形状口径一旦有两份，就会有一份随重构过期，于是"契约"和"实测"各说各话。
//
// 只取顶层：信封键（result 自身的键）+ data 的形态与顶层键。刻意不深潜 items[]/products[] 的字段：
// 那种契约没人维护，也测不出"顾客端少渲染一列"这类真问题（它只会在每次加字段时逼人改基线）。

/** 一条响应 → { envelope, dataKind, keys }。 */
export function shapeOf(result) {
  const envelope = Object.keys(result || {}).sort()
  const d = result && result.data
  let dataKind = 'absent'
  const keys = new Set()
  if (!(result && 'data' in result)) dataKind = 'absent'   // 失败信封根本没有 data 键，和 data:null 是两件事
  else if (d === null || d === undefined) dataKind = 'null'
  else if (Array.isArray(d)) { dataKind = 'array'; for (const it of d) if (it && typeof it === 'object') Object.keys(it).forEach((k) => keys.add(k)) }
  else if (typeof d === 'object') { dataKind = 'object'; Object.keys(d).forEach((k) => keys.add(k)) }
  else dataKind = 'scalar'
  return { envelope, dataKind, keys: [...keys].sort() }
}

/** 形状是否相同（数组顺序无关，因为两侧都排过序；这里仍逐项比以防上游忘了排序）。 */
export function sameShape(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
