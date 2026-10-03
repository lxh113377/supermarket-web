// 点名列表的有界展示（第六十五轮 M-64-4）
//
// 一手事实：第六十四轮修 `api-response-contract.mjs` 的 V4 时，门面印的是
// `字段漂移 [] 实测 ` —— 判红却点不出名，逼后来人 `--write` 覆盖一份本没变的契约账。
// 修完 V4 后逐根扫同族（本轮）抓到 8 处「`.slice(0, K)` 折叠掉具名、且分母不印」的出口：
// 它们比 V4 温和（至少印得出前几条），但**第 K+1 条永远看不见**，
// 于是「一处红」和「四十处红」在输出上长得一模一样 —— 这是判据的展示缺陷，不是被审面的。
//
// 口径：截断展示**必须**同时印出总数，且去重后再数（同名多计会让点名数与分母不符）。
// 只给"能红但说不出红在哪"的判据用；已被审面本身的数据不要走这里。
export function capped(list, n = 8, sep = ', ') {
  const arr = [...new Set((list || []).map((x) => String(x)))]
  if (!arr.length) return '（共 0 处）'
  const head = arr.slice(0, n).join(sep)
  return arr.length > n
    ? `${head} …只展示前 ${n}，共 ${arr.length} 处`
    : `${head}（共 ${arr.length} 处）`
}
