//! 评价域写动作的纯计算层：现网 functions/lib/actions/reviews.js 与 security.js:192 的守卫。
//!
//! 三个动作（addReview / addPublicReview / seedReviews）共用字段白名单与同一套 UGC 守卫；
//! addPublicReview 在现网就是 addReview 的**直接复用**（backend.js:153 一行调用）—— 差别只在入口：
//! 公开面免鉴权、有写限流、且**不落管理端审计**（审计只挂在 handleAdmin）。

use serde_json::{json, Value};

/// 现网 shared.js:19 的评价字段白名单（出现序即 INSERT 列序的一部分）。
pub const REVIEW_FIELDS: [&str; 5] = ["productOrder", "user", "rating", "text", "images"];
/// 单条评价最多 3 张图（现网 reviews.js 的 too_many_images 判据）。
pub const MAX_REVIEW_IMAGES: usize = 3;
/// 评价正文上限（现网 checkPublicText(clean.text, 500)）。
pub const REVIEW_TEXT_MAX: usize = 500;

/// 现网 db.js:37 的 pick：只留白名单里**存在**的键，顺序按白名单。
pub fn pick_review_fields(payload: Option<&Value>) -> Vec<(String, Value)> {
    let mut out: Vec<(String, Value)> = Vec::new();
    let Some(obj) = payload.and_then(|p| p.as_object()) else {
        return out;
    };
    for k in REVIEW_FIELDS {
        if let Some(v) = obj.get(k) {
            out.push((k.to_string(), v.clone()));
        }
    }
    out
}

/// 现网 security.js:192 的 checkPublicText：长度上限 + 四条基础黑名单（大小写不敏感）。
///
/// 这是**纵深防御的一种**，不是 HTML 注入的最终防线（最终防线在渲染端 React 转义）—— 别把它当安全边界。
pub fn check_public_text(text: &str, max_len: usize) -> bool {
    // 长度按 **UTF-16 码元** 计（现网是 String.length）：emoji 在 500 边界上与按字符计不同。
    if text.encode_utf16().count() > max_len {
        return false;
    }
    let low = text.to_lowercase();
    for bad in ["<script", "javascript:", "onerror=", "onload="] {
        if low.contains(bad) {
            return false;
        }
    }
    true
}

/// 评价行的三段归一（现网 reviews.js 的 doc 字面量）：
/// user = String(x || 匿名用户).slice(0,20)；rating = max(1, min(5, Number(x) || 5))；text = String(x || 空串).slice(0,500)。
pub fn normalize_review_author(payload: Option<&Value>) -> String {
    let raw = payload.and_then(|p| p.get("user"));
    // 先做 JS 的 || 匿名用户（**假值判定**：0 / 空串 / null / false 都落默认），再 String()。
    // 数组与对象是**真值**：String([]) 是空串、String({}) 是 "[object Object]" —— 复核点名要我钉这三类。
    let truthy = match raw {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
        _ => false,
    };
    if !truthy {
        return "匿名用户".to_string();
    }
    let s = match raw {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => crate::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        Some(Value::Bool(b)) => if *b { "true".to_string() } else { String::new() },
        Some(Value::Array(list)) => list
            .iter()
            .map(|v| match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => crate::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
                Value::Null => String::new(),
                _ => "[object Object]".to_string(),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
        _ => String::new(),
    };
    crate::order_intake::slice_utf16(&s, 20)
}

/// rating 归一：Number(x) || 5，再钳到 [1, 5]。
pub fn normalize_review_rating(payload: Option<&Value>) -> f64 {
    let n = crate::jsnum::js_number_of(payload.and_then(|p| p.get("rating")));
    let base = if n == 0.0 { 5.0 } else { n };
    // **不取整**：现网是 Math.max(1, Math.min(5, Number(x) || 5))，3.9 仍然是 3.9。
    // 我第一版返回 i64 截断（3.9→3），复核点名后改正 —— 这类「悄悄取整」不报错、只改数值。
    base.max(1.0).min(5.0)
}

/// 正文归一：String(x || 空串).slice(0, 500)。
pub fn normalize_review_text(payload: Option<&Value>) -> String {
    let raw = payload.and_then(|p| p.get("text"));
    let s = match raw {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => crate::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        Some(Value::Bool(b)) => {
            if *b { "true".to_string() } else { String::new() }
        }
        _ => String::new(),
    };
    crate::order_intake::slice_utf16(&s, REVIEW_TEXT_MAX)
}

/// 评价图册校验（现网 reviews.js 用的 validateImages 路径）：
/// 非数组 ⇒ 空表（**不是** invalid_image —— 现网在 reviews 里不先判 Array.isArray）；
/// 任一项非字符串或不安全 ⇒ None（调用方回 invalid_image）。
pub fn validate_review_images(v: Option<&Value>) -> Option<Vec<Value>> {
    let list = match v {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    for it in &list {
        match it {
            Value::String(s) if crate::order_intake::is_safe_image_url(s) => {}
            _ => return None,
        }
    }
    Some(list)
}

/// 图片合计字符数（现网 reduce 求 s + img.length）。
pub fn review_image_chars(images: &[Value]) -> usize {
    images
        .iter()
        .map(|v| v.as_str().map(|s| s.encode_utf16().count()).unwrap_or(0))
        .sum()
}

/// 单张超预算的文案（现网模板串逐字）。
pub fn image_too_large_message(len: usize, budget: usize) -> String {
    format!("单张图片过大（{len} 字符 > 预算 {budget}）")
}

/// 合计超预算的文案（现网模板串逐字）。
pub fn payload_too_large_message(chars: usize, budget: usize) -> String {
    format!("评价图片合计 {chars} 字符 > 单语句预算 {budget}：请减少张数或压小图片")
}

/// 种子评价（现网 reviews.js 的 SEED 常量，逐条照抄；seedReviews 只在**库为空**时写入）。
pub const SEED_REVIEWS: [(i64, &str, i64, &str); 20] = [
    (1, "小明", 5, "冰糖雪梨yyds，冰一下更好喝！"),
    (1, "阿杰", 4, "甜度刚好，1L够喝一天"),
    (5, "茶茶", 5, "康师傅绿茶永远的神，回购无数次"),
    (6, "路人甲", 4, "冰红茶配泡面绝了"),
    (8, "养生青年", 5, "东方树叶青柑普洱，无糖茶天花板"),
    (8, "打工人", 4, "解腻神器，吃完食堂来一瓶"),
    (14, "VC达人", 5, "水溶C100酸酸甜甜，补充维C"),
    (16, "熬夜选手", 5, "东鹏特饮期末周救命水"),
    (16, "考研人", 4, "便宜大碗，提神效果不错"),
    (18, "健身哥", 4, "500ml大瓶划算，运动前来一瓶"),
    (22, "可乐党", 5, "冰可乐夏天必备，快乐水！"),
    (22, "宅男", 5, "罐装就是比瓶装好喝，不接受反驳"),
    (24, "跑步人", 5, "农夫山泉有点甜，1.5L运动够用"),
    (32, "吃货", 5, "士力架横扫饥饿，下午续命必备"),
    (33, "薯片爱好者", 4, "乐事原味永远经典，40g刚好不怕胖"),
    (38, "辣条王", 5, "卫龙大面筋辣条yyds！"),
    (46, "深夜食堂", 5, "白象方便面加个卤蛋，宵夜天花板"),
    (46, "省钱达人", 4, "十三香味道不错，比食堂便宜多了"),
    (48, "早餐人", 4, "乡巴佬卤蛋配泡面，简单但满足"),
    (49, "火腿肠粉丝", 4, "双汇火腿肠烤一下更香"),
];
