// Hero 主视觉：splash 抽离后第一眼看到的东西。
// 只放三行字 + 一条向下指示线 —— 画面本身由背后的 3D 走廊承担，文字多了会跟它抢注意力。

interface Props {
  /** 已选文件数（右上角计数徽标）。 */
  fileCount: number
}

export default function PrintHero({ fileCount }: Props) {
  return (
    <section
      data-print-section
      className="print-section relative flex flex-col items-center justify-center px-6 text-center"
    >
      <div className="print-glass print-neon-edge rounded-3xl px-6 py-5 mb-7 animate-scale-in">
        <span className="block text-[11px] tracking-[0.4em] text-cyan-200/80 uppercase">CAMPUS PRINT</span>
        <span className="block mt-1 text-[12px] text-slate-400">文件交给走廊尽头那家打印店</span>
      </div>

      <h1 className="print-title text-[64px] leading-none font-bold tracking-tight">打印</h1>
      <p className="mt-5 text-[15px] leading-relaxed text-slate-300/90 max-w-[19rem]">
        上传文档或照片，写清楼栋与房间
        <br />
        印好直接送到你宿舍门口
      </p>

      <div className="mt-10 flex flex-col items-center gap-3">
        <div className="print-scroll-hint" />
        <span className="text-[11px] text-slate-500">向下滚动，走过这条走廊</span>
      </div>

      <div className="absolute top-6 right-5 flex items-center gap-2">
        {fileCount > 0 && (
          <span className="print-glass rounded-full px-3 py-1.5 text-[11px] text-cyan-200 animate-scale-in">
            已选 {fileCount} 个文件
          </span>
        )}
      </div>
    </section>
  )
}
