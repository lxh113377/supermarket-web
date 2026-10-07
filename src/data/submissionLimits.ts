// 服务提交的文件/图片条数上限（前端侧唯一真源）。
//
// 为什么单独一个模块：`functions/` 与 `src/` 是两条构建链、物理上不能共享模块
// （同 src/auth.ts 的 BATCH_UPDATE_CHUNK、src/utils/spec-options.ts 先例），
// 所以 `functions/lib/shared.js` 的 MAX_SUBMISSION_FILES 必须在这里再写一份，
// 两侧同值由 tests/printCapParity.test.ts 用等号钉住；改一侧不跟另一侧即红。
//
// 取值 = 9（2026-10-07 由 5 抬上来）：打印服务一次要交多页文档，5 个装不下；
// 9 与后台商品图册的 9 同值同族（一屏 3×3 的可视上界）。取值类别 product，
// 依据与归因见 docs/limit-provenance.md。
export const MAX_SUBMISSION_FILES = 9
