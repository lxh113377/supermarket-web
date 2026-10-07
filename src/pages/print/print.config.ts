// 打印页常量（前端侧唯一真源）。
//
// 三条与服务端同值的常量在这里收口，由 tests/printCapParity.test.ts 用**等号**钉住：
//   MAX_PRINT_FILES        ⇄ functions/lib/shared.js  MAX_SUBMISSION_FILES
//   PRINT_FILE_MAX_BYTES   ⇄ functions/lib/shared.js  PRINT_FILE_MAX_BYTES
//   PRINT_ALLOWED_EXT      ⇄ functions/upload.js      ALLOWED_EXT
// 两条构建链不能共享模块 ⇒ 必然双写；不同值 = 顾客在屏上按提示操作却被服务端拒，
// 这是本仓第十八轮评价图那条老伤的同族，故用测试而不是注释来保证。

export { MAX_SUBMISSION_FILES } from '../../data/submissionLimits'

/** 打印单可带文件数上限（与服务端 MAX_SUBMISSION_FILES 同值）。 */
export const MAX_PRINT_FILES = 9

/** 单文件上限：与服务端 PRINT_FILE_MAX_BYTES 同值。 */
export const PRINT_FILE_MAX_BYTES = 20 * 1024 * 1024

/** 允许的扩展名：与 functions/upload.js 的 ALLOWED_EXT 逐项同序同值。 */
export const PRINT_ALLOWED_EXT = [
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'gif',
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt',
] as const

/** <input accept>：给系统文件选择器用（iOS/Android 会据此过滤）。 */
export const PRINT_ACCEPT = PRINT_ALLOWED_EXT.map((e) => `.${e}`).join(',')

/**
 * 内联降级（R2 未就绪 / 上传端点不可达）的单文件上限：512KB 二进制。
 * 超过这个尺寸就必须走 R2；达不到时前端直接提示用户，而不是等服务端回 payload_too_large。
 */
export const MAX_INLINE_UPLOAD_BYTES = 512 * 1024

/** 文件类型分组：只影响图标与文案，不参与准入判定（准入一律看扩展名）。 */
export const FILE_KIND_LABEL: Record<string, string> = {
  pdf: 'PDF', doc: 'Word', docx: 'Word', ppt: 'PPT', pptx: 'PPT',
  xls: 'Excel', xlsx: 'Excel', txt: '文本',
}
