//! 订单状态机（纯计算）：现网 functions/lib/actions/orders.js:399 的 ORDER_TRANSITIONS 与判定文案。
//!
//! 这张表是**单点强制的迁移合法性**：status 列是 TEXT、没有 CHECK 约束（扩态零迁移），
//! 所以「哪些流转合法」只存在于这里。抄错不会报错，只会让管理员点出不该点的状态。

/// 现网 ORDER_TRANSITIONS 的逐字映射（顺序也照抄：数组顺序决定不了语义，但 alias 认知靠它）。
pub const ORDER_TRANSITIONS: [(&str, &[&str]); 5] = [
    ("pending", &["paid", "cancelled"]),
    ("paid", &["delivering", "cancelled"]),
    ("delivering", &["completed", "cancelled"]),
    ("completed", &[]),
    ("cancelled", &["pending"]),
];

/// 状态名是否在册（现网 Object.prototype.hasOwnProperty.call(ORDER_TRANSITIONS, status)）。
pub fn status_known(status: &str) -> bool {
    ORDER_TRANSITIONS.iter().any(|(k, _)| *k == status)
}

/// 迁移是否合法（现网 (ORDER_TRANSITIONS[cur] || []).includes(status)）。
pub fn transition_allowed(current: &str, next: &str) -> bool {
    ORDER_TRANSITIONS
        .iter()
        .find(|(k, _)| *k == current)
        .map(|(_, allowed)| allowed.contains(&next))
        .unwrap_or(false)
}

/// 非法流转的逐字文案（现网里是模板串）。
pub fn invalid_transition_message(current: &str, next: &str) -> String {
    format!("不允许的状态流转: {current} → {next}")
}

/// 删除订单时是否需要回补库存：进行中单（pending/paid/delivering）要回补；
/// cancelled 已在取消时释放、completed 视为已交付消耗 —— 都不回补（防删除历史单凭空加库存）。
pub fn delete_needs_release(status: &str) -> bool {
    status != "cancelled" && status != "completed"
}
