// 打印提交的容量常量（前端侧唯一真源）。
//
// 2026-10-21：打印页（/print）已整体替换为外站「校园打印」应用，本文件不再是"打印页"的常量，
// 而是**本站后台打印提交（SubmissionsTab 的上传路径）与服务端之间**的同值收口 ——
// 后台仍能接收与查看打印提交（含历史数据），所以这条等号仍然必须钉住。
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
 * **内联降级**这条路真正能收的扩展名（比上面那条窄）。
 *
 * 为什么必须分开写：`/upload`（R2 直传）看的是服务端 `ALLOWED_EXT` 那份宽名单，
 * 而 R2 是**账号级开关**、实测未开通（`POST /upload` 回 500 `print_storage_unavailable`），
 * 于是实际走的是「转成 data: URL 内联进提交体」——那份准入由服务端
 * `isSafePrintFileRef` 的正则决定，它只认 image/(jpeg|png|webp|gif)、application/pdf、
 * application/msword 与 officedocument.* ⇒ `ppt/xls/heic/txt` 在宽名单里、在内联准入外。
 * 让顾客按屏上提示选了 PPT、提交时才被服务端判「文件格式无效」，正是本文件头注释
 * 立项要防的那类事，所以表单侧的 accept 一律用**这份窄名单**。
 * 由 tests/printCapParity.test.ts 拿服务端源码里的正则逐项对账，不许手写记忆。
 */
export const PRINT_INLINE_ALLOWED_EXT = [
  'pdf', 'doc', 'docx', 'pptx', 'xlsx', 'jpg', 'jpeg', 'png', 'webp', 'gif',
] as const

/** 表单侧 <input accept>：用窄名单（见上）。 */
export const PRINT_INLINE_ACCEPT = PRINT_INLINE_ALLOWED_EXT.map((e) => `.${e}`).join(',')


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
