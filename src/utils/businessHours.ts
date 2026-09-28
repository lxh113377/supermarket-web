// 营业时间检测
// 工作日(周一至五): 17:37 - 23:00 (晚12点后谢绝)
// 周末与节假日: 13:00 - 次日1:00 (午1点-晚1点)

export function isBusinessHours(date = new Date()) {
  const day = date.getDay() // 0=周日, 6=周六
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const currentMinutes = hours * 60 + minutes

  const isWeekend = day === 0 || day === 6

  if (isWeekend) {
    // 周末: 13:00 - 次日1:00
    // 即 13:00-23:59 或 0:00-1:00
    if (currentMinutes >= 13 * 60) return true // 13:00之后
    if (currentMinutes < 1 * 60) return true // 凌晨1点之前(前一天开始的)
    return false
  } else {
    // 工作日: 17:37 - 23:00
    if (currentMinutes >= 17 * 60 + 37 && currentMinutes < 23 * 60) return true
    return false
  }
}

export function getBusinessHoursText() {
  return '工作日(周一至五) 17:37-23:00 | 周末与节假日 13:00-次日1:00'
}

export function getClosedMessage() {
  return '当前非营业时间，请在群内先与商家确认营业后再下单'
}
