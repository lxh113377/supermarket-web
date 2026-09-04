// echarts lib 深路径无随包类型声明（package.json exports 未附 .d.ts）。
// 这些模块 default 导出 install 对象，仅传给 echarts/core 的 use()；
// use 参数处已收敛为 any（见 useDashboardCharts.ts），此处从宽声明即可。
declare module 'echarts/lib/chart/line' {
  const install: unknown
  export default install
}
declare module 'echarts/lib/chart/pie' {
  const install: unknown
  export default install
}
declare module 'echarts/lib/chart/bar' {
  const install: unknown
  export default install
}
declare module 'echarts/lib/component/grid' {
  const install: unknown
  export default install
}
declare module 'echarts/lib/component/tooltip' {
  const install: unknown
  export default install
}
declare module 'echarts/lib/component/legend' {
  const install: unknown
  export default install
}
declare module 'echarts/lib/component/dataZoom' {
  const install: unknown
  export default install
}
declare module 'echarts/lib/component/dataZoomInside' {
  const install: unknown
  export default install
}
declare module 'echarts/lib/component/dataZoomSlider' {
  const install: unknown
  export default install
}
