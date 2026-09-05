// echarts lib 深路径无随包类型声明（package.json exports 未附 .d.ts）。
// install 对象仅传给 echarts/core 的 use()，类型收敛为 use() 的插件形参
// （echarts 公开 API 类型，替代旧 unknown + as any 借道）。
type EChartsInstall = Parameters<typeof import('echarts/core').use>[0]

declare module 'echarts/lib/chart/line' {
  const install: EChartsInstall
  export default install
}
declare module 'echarts/lib/chart/pie' {
  const install: EChartsInstall
  export default install
}
declare module 'echarts/lib/chart/bar' {
  const install: EChartsInstall
  export default install
}
declare module 'echarts/lib/component/grid' {
  const install: EChartsInstall
  export default install
}
declare module 'echarts/lib/component/tooltip' {
  const install: EChartsInstall
  export default install
}
declare module 'echarts/lib/component/legend' {
  const install: EChartsInstall
  export default install
}
declare module 'echarts/lib/component/dataZoom' {
  const install: EChartsInstall
  export default install
}
declare module 'echarts/lib/component/dataZoomInside' {
  const install: EChartsInstall
  export default install
}
declare module 'echarts/lib/component/dataZoomSlider' {
  const install: EChartsInstall
  export default install
}
