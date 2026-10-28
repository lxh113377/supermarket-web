use serde_json::json;
use supermarket_core::ai_rules::rule_advice;

#[test]
fn n_rule_advice_pins_the_full_text_on_synthetic_input() {
    // 合成输入 ⇒ 全文完全确定（这条比在夹具里钉前缀更稳，也不依赖现网评价数据）
    let orders = vec![
        json!({ "items": [{ "name": "可乐", "spec": "500ml", "quantity": 3 }], "totalAmount": 30 }),
        json!({ "items": [{ "name": "可乐", "spec": "500ml", "quantity": 2 }, { "name": "面包", "spec": "", "quantity": 1 }], "totalAmount": 20 }),
    ];
    let reviews = vec![json!({ "rating": 2 }), json!({ "rating": 5 })];
    assert_eq!(
        rule_advice(&orders, &reviews),
        [
            "📊 近 30 天：营收 ¥50，共 2 单。",
            "1. 优先备货热销：可乐(500ml)、面包，按平日 1.2 倍预备。",
            "2. 易损鲜蔬/乳品按需采购，避免隔夜损耗。",
            "3. 近 30 天有 1 条低分评价，建议复盘对应商品与服务话术。",
            "配置 Dify 后可生成更精细的备货/定价建议。",
        ]
        .join("\n")
    );
    // 无订单 ⇒ 固定话术
    assert_eq!(
        rule_advice(&[], &[]),
        "暂无近 30 天订单数据，待顾客下单后生成经营建议。"
    );
    // 有订单但无热销项 ⇒ 第 3 行仍是字面 "2."（现网编号写死在字符串里，不是笔误）
    let no_items = vec![json!({ "items": [], "totalAmount": 10 })];
    let text = rule_advice(&no_items, &[]);
    assert!(text.contains("📊 近 30 天：营收 ¥10，共 1 单。"));
    assert!(text.contains("2. 易损鲜蔬/乳品按需采购"));
    assert!(!text.contains("1. 优先备货热销"));
    // 低分为 0 ⇒ 不出现第 3 行
    assert!(!rule_advice(&no_items, &[json!({ "rating": 3 })]).contains("低分评价"));
    // 评分 <= 2 计入（边界：2 计入、3 不计入）
    assert!(rule_advice(&no_items, &[json!({ "rating": 2 })]).contains("有 1 条低分评价"));
}
