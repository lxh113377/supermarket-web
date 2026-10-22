// 起送门槛（前端侧唯一真源）：商品总价低于此值不配送。
//
// 为什么单独一个模块：`functions/` 与 `src/` 是两条构建链、物理上不能共享模块
// （同 src/auth.ts 的 BATCH_UPDATE_CHUNK、src/data/submissionLimits.ts 先例），
// 所以 `functions/lib/shared.js` 的 MIN_DELIVERY_AMOUNT 必须在这里再写一份，
// 两侧同值由 tests/minDeliveryParity.test.ts 用等号钉住；改一侧不跟另一侧即红。
//
// 取值 = 6（2026-10-22 老大立规「购买物品总价低于六元不配送」）。
// 类别 product，依据与口径（按**折前小计**判、不受满减影响）见 docs/limit-provenance.md。
export const MIN_DELIVERY_AMOUNT = 6

/** 是否已达起送门槛。金额口径 = 购物车商品小计（折前、不含运费）。 */
export function meetsMinDelivery(totalAmount: number): boolean {
  // 两位小数归一后再比，避开 0.1+0.2 这类浮点尾巴把「刚好 6 元」误判成不足
  return Math.round(totalAmount * 100) >= Math.round(MIN_DELIVERY_AMOUNT * 100)
}

/** 距离起送还差多少钱（已达标返回 0）。 */
export function minDeliveryGap(totalAmount: number): number {
  const gap = Math.round((MIN_DELIVERY_AMOUNT - totalAmount) * 100) / 100
  return gap > 0 ? gap : 0
}
