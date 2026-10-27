//! 行 → JSON 形状映射的对账用例（与 `functions/lib/actions/products.js` 逐条对齐）。
//!
//! 为什么这些用例必须先于「原生动作」写：映射错了不会 500，只会让某个字段悄悄变成
//! `null`/`0`/`[]`（前端不报错、数据已错）。所以这里断言的是**完整 JSON 文本**
//! （含字段顺序），而不是"某几个键存在"。

use serde_json::{json, Value};
use supermarket_core::api_shapes::{
    catalog_orders, jparse, order_status_data, review_row_to_json, row_to_category, row_to_product,
};

fn s(v: Value) -> String {
    serde_json::to_string(&v).unwrap()
}

#[test]
fn a_jparse_follows_js() {
    // null / 缺失 ⇒ fallback
    assert_eq!(jparse(None, json!([])), json!([]));
    assert_eq!(jparse(Some(&Value::Null), json!(["x"])), json!(["x"]));
    // 非字符串原样返回（D1 的 JSON 列有时已被驱动解析）
    assert_eq!(jparse(Some(&json!(["a"])), json!([])), json!(["a"]));
    // 字符串能解析就解析，坏了落 fallback
    assert_eq!(jparse(Some(&json!("[\"a\",1]")), json!([])), json!(["a", 1]));
    assert_eq!(jparse(Some(&json!("{不是 JSON")), json!([])), json!([]));
}

#[test]
fn a_row_to_product_matches_key_order_and_defaults() {
    // 一行"干净"数据：JSON 文本列 + 数字/布尔
    let row = json!({
        "_id": "p006",
        "name": "康师傅冰红茶",
        "spec": "1L",
        "price": 3.5,
        "costPrice": 0,
        "subcategories": "[\"tea\",\"sweet\"]",
        "enabled": 1,
        "order": 6,
        "image": "",
        "description": "",
        "stock": -1,
        "specOptions": "[{\"label\":\"柠檬味\",\"enabled\":true}]"
    });
    let got = s(row_to_product(&row));
    // 字段顺序 = JS 对象字面量顺序（靠 serde_json 的 preserve_order 保持）
    assert_eq!(
        got,
        "{\"_id\":\"p006\",\"name\":\"康师傅冰红茶\",\"spec\":\"1L\",\"price\":3.5,\"costPrice\":0,\"subcategories\":[\"tea\",\"sweet\"],\"enabled\":true,\"order\":6,\"image\":\"\",\"images\":[],\"description\":\"\",\"specOptions\":[{\"label\":\"柠檬味\",\"enabled\":true}],\"reviews\":[],\"stock\":-1}"
    );
}

#[test]
fn a_row_to_product_dirty_values_follow_js_quirks() {
    // 缺 spec / 缺 images / 缺 reviews（SQL 没选这些列）⇒ 各自落默认值
    let row = json!({ "_id": "p1", "name": "n", "price": null, "enabled": "1", "stock": null });
    let got = row_to_product(&row);
    assert_eq!(got["spec"], json!(""));
    assert_eq!(got["price"], json!(0), "Number(null) || 0");
    assert_eq!(got["enabled"], json!(false), "严格等于：字符串 \"1\" 不算上架");
    assert_eq!(got["images"], json!([]));
    assert_eq!(got["reviews"], json!([]));
    assert_eq!(got["stock"], json!(-1), "null ⇒ -1（不限售）");

    // enabled === true 也算上架；stock 向零截断（-2.7 ⇒ -2，不是 -3）
    let row2 = json!({ "_id": "p2", "name": "n", "enabled": true, "stock": -2.7 });
    let got2 = row_to_product(&row2);
    assert_eq!(got2["enabled"], json!(true));
    assert_eq!(got2["stock"], json!(-2));

    // specOptions 是"对象"（脏值）⇒ 空数组；是标量同理
    let row3 = json!({ "_id": "p3", "name": "n", "specOptions": "{\"a\":1}" });
    assert_eq!(row_to_product(&row3)["specOptions"], json!([]));
    let row4 = json!({ "_id": "p4", "name": "n", "specOptions": "42" });
    assert_eq!(row_to_product(&row4)["specOptions"], json!([]));
    // 坏 JSON 的 subcategories ⇒ 空数组（jparse 的 fallback）
    let row5 = json!({ "_id": "p5", "name": "n", "subcategories": "{oops" });
    assert_eq!(row_to_product(&row5)["subcategories"], json!([]));
}

#[test]
fn a_row_to_category_matches_js() {
    let row = json!({ "_id": "c1", "name": "饮品", "type": "top", "order": "2", "subcategories": "[{\"id\":\"tea\"}]" });
    assert_eq!(
        s(row_to_category(&row)),
        "{\"_id\":\"c1\",\"name\":\"饮品\",\"type\":\"top\",\"order\":2,\"subcategories\":[{\"id\":\"tea\"}]}"
    );
    // 缺 type ⇒ ''；order 取不出 ⇒ 0
    let row2 = json!({ "_id": "c2", "name": "食品", "order": null });
    let got = row_to_category(&row2);
    assert_eq!(got["type"], json!(""));
    assert_eq!(got["order"], json!(0));
}

#[test]
fn a_review_row_follows_spread_semantics() {
    // 行键序 = SQL SELECT 的列序（D1 的返回顺序），images 是 JSON 文本列
    let row = json!({
        "_id": "r_1", "user": "匿名用户", "rating": 5, "text": "好喝",
        "productOrder": 6, "createdAt": "2026-10-27T00:00:00.000Z", "images": "[\"data:image/png;base64,AAA\"]"
    });
    assert_eq!(
        s(review_row_to_json(&row)),
        "{\"_id\":\"r_1\",\"user\":\"匿名用户\",\"rating\":5,\"text\":\"好喝\",\"productOrder\":6,\"createdAt\":\"2026-10-27T00:00:00.000Z\",\"images\":[\"data:image/png;base64,AAA\"]}"
    );
    let dirty = json!({ "_id": "r_2", "images": "{oops" });
    assert_eq!(s(review_row_to_json(&dirty)), "{\"_id\":\"r_2\",\"images\":[]}");
    let missing = json!({ "_id": "r_3" });
    assert_eq!(s(review_row_to_json(&missing)), "{\"_id\":\"r_3\",\"images\":[]}");
    let parsed = json!({ "_id": "r_4", "images": ["a.png"] });
    assert_eq!(s(review_row_to_json(&parsed)), "{\"_id\":\"r_4\",\"images\":[\"a.png\"]}");
}

#[test]
fn a_order_status_data_matches_js_object() {
    let row = json!({ "status": "已完成", "updatedAt": "2026-10-27T01:02:03.000Z" });
    assert_eq!(
        s(order_status_data("o_abc", &row)),
        "{\"orderId\":\"o_abc\",\"status\":\"已完成\",\"updatedAt\":\"2026-10-27T01:02:03.000Z\"}"
    );
    let sparse = json!({ "status": "待支付" });
    assert_eq!(s(order_status_data("o_x", &sparse)), "{\"orderId\":\"o_x\",\"status\":\"待支付\",\"updatedAt\":null}");
}

#[test]
fn a_catalog_orders_dedupes_and_flags_missing_images() {
    let rows = vec![
        json!({ "order": 6, "image": "" }),
        json!({ "order": 6, "image": "x.webp" }),     // 重复 ⇒ 只留第一条
        json!({ "order": "7", "image": "y.webp" }),   // 字符串数字 ⇒ 接受
        json!({ "order": 2.5, "image": "" }),         // 非整数 ⇒ 拒
        json!({ "order": 0, "image": "" }),           // <=0 ⇒ 拒
        json!({ "order": -3, "image": "" }),          // 负 ⇒ 拒
        json!({ "order": null, "image": "" }),        // null ⇒ 拒
        json!({ "order": 3.0, "image": "   " }),      // 3.0 是整数 ⇒ 接受；空白 image ⇒ needsLocalImage
    ];
    let got = catalog_orders(&rows);
    assert_eq!(
        s(Value::Array(got)),
        "[{\"order\":6,\"needsLocalImage\":true},{\"order\":7,\"needsLocalImage\":false},{\"order\":3,\"needsLocalImage\":true}]"
    );
}
