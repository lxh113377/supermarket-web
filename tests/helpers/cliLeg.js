/**
 * CLI 腿的"先证跑成了"守卫（第五十四轮 R54-H4）。
 *
 * 一手起因：全链跑时 `变异体 M2` 报 `expected '' to contain 'branch=main'`，单跑 28/28 绿、
 * 下一次全链 110/110 绿。真值不是判据变宽，而是并行负载把 `spawnSync(..., {timeout: 20_000})`
 * 打断 ⇒ `status === null`、`stdout === ''`，而夹具把那个空串当成"判据给出的结论"继续做内容断言。
 * 空输出与"它判了个空"长得一模一样，所以**必须由被调方自己声明有没有跑成**（户内规：自检须自证跑成了）。
 */

/**
 * @param r        spawnSync 的返回值
 * @param o.label  这条腿的名字（进错误消息，便于下一次直接定位）
 * @param o.budgetMs 该腿声明的时间预算；缺省则从 r.options 拿，拿不到印 `?`
 * @returns 原样返回 r（这样调用点可以链式用）
 * @throws 当 status 为 null/undefined（超时或被信号杀死）时抛具名错误，**绝不把空 stdout 交回调用方**
 */
export function assertCliRan(r, { label = 'CLI 腿', budgetMs } = {}) {
  if (r === null || r === undefined) {
    throw new Error(`[cli-leg-unrun] ${label}：根本没拿到 spawnSync 返回值`)
  }
  if (r.status === null || r.status === undefined) {
    const sig = r.signal === null || r.signal === undefined ? 'unknown' : r.signal
    const budget = budgetMs ?? (r.options && r.options.timeout) ?? '?'
    const bytes = Buffer.byteLength(String(r.stdout || ''))
    throw new Error(
      `[cli-leg-timeout] ${label}：status=null（signal=${sig}，预算=${budget}ms，stdout=${bytes}B）`
      + ' ⇒ 这是**这条腿没跑成**，不是被测对象的结论；空输出不得继续做内容断言（提预算或拆负载，别改判据）'
    )
  }
  return r
}
