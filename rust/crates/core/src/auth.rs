//! /web 鉴权语义（**纯函数**，无 IO）：从现网 `functions/lib/security.js` 与 `functions/lib/backend.js` 逐条对齐。
//!
//! ## 为什么这层必须逐条对齐（而不是「大概实现个鉴权」）
//!
//! 现网的管理端鉴权有四条**可观察**的语义，任何一条抄漏都会产生安全或兼容缺口：
//!
//! 1. **密钥只走 body**（`web.js:21` 解构 `{ action, adminKey, payload }`）—— 全仓没有 `x-admin-key`/
//!    `Authorization` 通道；原生化后若改成读请求头，前端一个字都不改就全 401。
//! 2. **常时比较**（`security.js:17`）：长度不等即 false，否则逐字节 XOR 累加。
//!    普通 `==` 会在失配处提前返回，把密钥前缀泄露成时间侧信道。
//! 3. **只读档是「白名单默认拒」**（`backend.js:91`）：`role === 'readonly' && !ADMIN_READ_ACTIONS.has(action)` ⇒ `readonly_denied`。
//!    方向很关键：**没登记 = 拒**（若反成「在写动作表里才拒」，漏登一个写动作的后果就是只读密钥能写）。
//! 4. **鉴权先于动作校验**：未知动作 + 无密钥 ⇒ 401（不是 400）—— 判据要按这个顺序断言。
//!
//! 三张动作表（PUBLIC / ADMIN_READ / ADMIN_WRITE）在这里是**常量**，同步性由用例钉住：
//! `tests/auth.rs` 会去读那两个 JS 文件、把 `new Set([`]) `块解出来逐条比对 ——
//! 现网增删一个动作而 Rust 没跟，当场判红（抄一份常量而不判同步，等于给未来埋一个静默缺口）。

use serde_json::Value;

/// `security.js:9` —— 免鉴权动作（`/web` 的「回退路径」与 `/pub` 共用这批）。
pub const PUBLIC_ACTIONS: [&str; 9] = [
    "createOrder", "getReviews", "createSubmission", "addPublicReview",
    "getPublicProducts", "getPublicCategories", "aiChat", "getOrderStatus", "getCatalogOrders",
];

/// `backend.js:56` —— 只读密钥**显式可用**的穷举表（未登记 ⇒ 拒）。
pub const ADMIN_READ_ACTIONS: [&str; 18] = [
    "login", "verifyKey", "getProducts", "stalePendingReport", "getOrders", "getOrder",
    "getPublicProducts", "getPublicCategories", "getAllReviews", "getReviews", "getOrderStatus",
    "getSubmissions", "getSubmissionImages", "aiAdvice", "getDashboardStats", "getStockMovements",
    "getPromotions", "getEventLog",
];

/// `backend.js:39` —— 管理写动作（用于审计口径与文档，不用于授权判定）。
pub const ADMIN_WRITE_ACTIONS: [&str; 17] = [
    "createProduct", "updateProduct", "deleteProduct", "batchUpdateProducts", "batchDeleteProducts",
    "createOrder", "recalculateOrders", "adjustStock", "addReview", "addPublicReview", "seedReviews",
    "deleteOrder", "updateOrderStatus", "deleteReview", "createSubmission", "updateSubmissionStatus",
    "deleteSubmission",
];

/// 角色：现网是字符串 `'admin'` / `'readonly'` / `null`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Admin,
    Readonly,
}

/// `security.js:17` 的 `constantTimeEqual`：长度不等即 false；否则逐字节 XOR 累加。
///
/// 注意：JS 侧对非字符串一律当 `''`（`typeof a === `'string' ? a : ''`）；
/// Rust 侧用 `Option<&str>` 表示「没给」，语义等价于空串（长度不等 ⇒ false），
/// 但**空串 vs 空串**在 JS 里是 true —— 而现网 env 未配置时该分支直接短路，所以不会因此放行。这里照搬 JS。
pub fn constant_time_equal(a: &str, b: &str) -> bool {
    let (ea, eb) = (a.as_bytes(), b.as_bytes());
    if ea.len() != eb.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for i in 0..ea.len() {
        diff |= ea[i] ^ eb[i];
    }
    diff == 0
}

/// `security.js:201` 的 `resolveRole`：先比全权限键，再比只读键，都不中 ⇒ None。
pub fn resolve_role(
    admin_key: Option<&str>,
    admin: Option<&str>,
    readonly: Option<&str>,
) -> Option<Role> {
    // JS: if (env.ADMIN_KEY && constantTimeEqual(adminKey, env.ADMIN_KEY)) —— 未配置就跳过该分支
    if let Some(want) = admin {
        if constant_time_equal(admin_key.unwrap_or(""), want) {
            return Some(Role::Admin);
        }
    }
    if let Some(want) = readonly {
        if constant_time_equal(admin_key.unwrap_or(""), want) {
            return Some(Role::Readonly);
        }
    }
    None
}

pub fn is_public_action(action: &str) -> bool {
    PUBLIC_ACTIONS.contains(&action)
}

pub fn is_admin_read_action(action: &str) -> bool {
    ADMIN_READ_ACTIONS.contains(&action)
}

/// `security.js:207` 的 `checkAuth`：公开动作免鉴权；否则角色为 None 即失败。
///
/// 返回 `Some(失败封套)` 时调用方必须**原样**返回它（并补审计），不得自行改造形状。
pub fn check_auth(
    action: &str,
    admin_key: Option<&str>,
    admin: Option<&str>,
    readonly: Option<&str>,
) -> Option<Value> {
    if is_public_action(action) {
        return None;
    }
    if resolve_role(admin_key, admin, readonly).is_none() {
        // 现网文案逐字：fail('auth_failed', '认证失败')
        return Some(crate::errors::fail("auth_failed", "认证失败", Default::default()));
    }
    None
}

/// `backend.js:91` 的只读档判定。
pub fn check_readonly(action: &str, role: Option<Role>) -> Option<Value> {
    if role == Some(Role::Readonly) && !is_admin_read_action(action) {
        return Some(crate::errors::fail("readonly_denied", "只读账号不能执行该操作", Default::default()));
    }
    None
}
