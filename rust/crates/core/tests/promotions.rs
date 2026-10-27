use serde_json::json;

#[test]
fn g_promotion_tiers_match_js() {
    let tiers = vec![
        // 完整档位
        json!({ "_id": "t1", "name": "满20减3", "threshold": 20, "discount": 3, "enabled": 1, "updatedAt": "2026-10-01T00:00:00.000Z" }),
        // 缺列/空串/字符串数字：name 与 updatedAt 落空串；threshold 取字符串；enabled 是 "1"
        json!({ "_id": "t2", "threshold": "15", "discount": null, "enabled": "1" }),
        // enabled 各种形态
        json!({ "_id": "t3", "enabled": true }),
        json!({ "_id": "t4", "enabled": 2 }),
        json!({ "_id": "t5", "enabled": "true" }),
        json!({ "_id": "t6", "enabled": 0 }),
    ];
    let hits = vec![
        json!({ "promotionId": "t1", "orders": "12", "totalDiscount": 36 }),
        json!({ "promotionId": "t9", "orders": 5, "totalDiscount": 5 }), // 无对应档位 ⇒ 被丢弃
    ];
    let out = supermarket_core::api_shapes::promotion_tiers_to_json(&tiers, &hits);
    assert_eq!(
        serde_json::to_string(&out).unwrap(),
        "[{\"_id\":\"t1\",\"name\":\"满20减3\",\"threshold\":20,\"discount\":3,\"enabled\":true,\"updatedAt\":\"2026-10-01T00:00:00.000Z\",\"hits\":{\"orders\":12,\"totalDiscount\":36}},"
            .to_string()
            + "{\"_id\":\"t2\",\"name\":\"\",\"threshold\":15,\"discount\":0,\"enabled\":true,\"updatedAt\":\"\",\"hits\":{\"orders\":0,\"totalDiscount\":0}},"
            + "{\"_id\":\"t3\",\"name\":\"\",\"threshold\":0,\"discount\":0,\"enabled\":true,\"updatedAt\":\"\",\"hits\":{\"orders\":0,\"totalDiscount\":0}},"
            + "{\"_id\":\"t4\",\"name\":\"\",\"threshold\":0,\"discount\":0,\"enabled\":false,\"updatedAt\":\"\",\"hits\":{\"orders\":0,\"totalDiscount\":0}},"
            + "{\"_id\":\"t5\",\"name\":\"\",\"threshold\":0,\"discount\":0,\"enabled\":false,\"updatedAt\":\"\",\"hits\":{\"orders\":0,\"totalDiscount\":0}},"
            + "{\"_id\":\"t6\",\"name\":\"\",\"threshold\":0,\"discount\":0,\"enabled\":false,\"updatedAt\":\"\",\"hits\":{\"orders\":0,\"totalDiscount\":0}}]"
    );
    // 空档位 ⇒ 空数组（现网 catch 分支也是这个形状）
    assert_eq!(
        serde_json::to_string(&supermarket_core::api_shapes::promotion_tiers_to_json(&[], &[])).unwrap(),
        "[]"
    );
}

