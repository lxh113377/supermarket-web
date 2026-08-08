// 种子评价（与 src/data/reviews-seed.js 同源，云端首次导入用）
// 部署后由管理 action seedReviews 幂等导入（sm_reviews 非空则跳过）
module.exports = {
  SEED_REVIEWS: [
    { productOrder: 1, user: '小明', rating: 5, text: '冰糖雪梨yyds，冰一下更好喝！' },
    { productOrder: 1, user: '阿杰', rating: 4, text: '甜度刚好，1L够喝一天' },
    { productOrder: 5, user: '茶茶', rating: 5, text: '康师傅绿茶永远的神，回购无数次' },
    { productOrder: 6, user: '路人甲', rating: 4, text: '冰红茶配泡面绝了' },
    { productOrder: 8, user: '养生青年', rating: 5, text: '东方树叶青柑普洱，无糖茶天花板' },
    { productOrder: 8, user: '打工人', rating: 4, text: '解腻神器，吃完食堂来一瓶' },
    { productOrder: 14, user: 'VC达人', rating: 5, text: '水溶C100酸酸甜甜，补充维C' },
    { productOrder: 16, user: '熬夜选手', rating: 5, text: '东鹏特饮期末周救命水' },
    { productOrder: 16, user: '考研人', rating: 4, text: '便宜大碗，提神效果不错' },
    { productOrder: 18, user: '健身哥', rating: 4, text: '500ml大瓶划算，运动前来一瓶' },
    { productOrder: 22, user: '可乐党', rating: 5, text: '冰可乐夏天必备，快乐水！' },
    { productOrder: 22, user: '宅男', rating: 5, text: '罐装就是比瓶装好喝，不接受反驳' },
    { productOrder: 24, user: '跑步人', rating: 5, text: '农夫山泉有点甜，1.5L运动够用' },
    { productOrder: 32, user: '吃货', rating: 5, text: '士力架横扫饥饿，下午续命必备' },
    { productOrder: 33, user: '薯片爱好者', rating: 4, text: '乐事原味永远经典，40g刚好不怕胖' },
    { productOrder: 38, user: '辣条王', rating: 5, text: '卫龙大面筋辣条yyds！' },
    { productOrder: 46, user: '深夜食堂', rating: 5, text: '白象方便面加个卤蛋，宵夜天花板' },
    { productOrder: 46, user: '省钱达人', rating: 4, text: '十三香味道不错，比食堂便宜多了' },
    { productOrder: 48, user: '早餐人', rating: 4, text: '乡巴佬卤蛋配泡面，简单但满足' },
    { productOrder: 49, user: '火腿肠粉丝', rating: 4, text: '双汇火腿肠烤一下更香' },
  ],
}
