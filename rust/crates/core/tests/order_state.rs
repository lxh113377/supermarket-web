use supermarket_core::order_state::{
    delete_needs_release, invalid_transition_message, status_known, transition_allowed,
};

#[test]
fn k_transition_table_matches_the_live_mapping() {
    // 合法流转（逐条照现网表）
    assert!(transition_allowed("pending", "paid"));
    assert!(transition_allowed("pending", "cancelled"));
    assert!(transition_allowed("paid", "delivering"));
    assert!(transition_allowed("paid", "cancelled"));
    assert!(transition_allowed("delivering", "completed"));
    assert!(transition_allowed("delivering", "cancelled"));
    assert!(transition_allowed("cancelled", "pending"));
    // 非法：completed 是终态；不能跳级；不能回退（除 cancelled→pending 这条恢复链）
    assert!(!transition_allowed("completed", "pending"));
    assert!(!transition_allowed("completed", "cancelled"));
    assert!(!transition_allowed("pending", "delivering"));
    assert!(!transition_allowed("pending", "completed"));
    assert!(!transition_allowed("paid", "completed"));
    assert!(!transition_allowed("paid", "pending"));
    assert!(!transition_allowed("cancelled", "paid"));
    // 在册状态判定
    assert!(status_known("pending") && status_known("cancelled") && status_known("completed"));
    assert!(!status_known("shipped"));
    assert!(!status_known(""));
}

#[test]
fn k_invalid_transition_message_matches_the_template() {
    assert_eq!(
        invalid_transition_message("completed", "pending"),
        "不允许的状态流转: completed → pending"
    );
    assert_eq!(
        invalid_transition_message("pending", "completed"),
        "不允许的状态流转: pending → completed"
    );
}

#[test]
fn k_delete_release_rule() {
    // 进行中单要回补；取消/完成不回补
    assert!(delete_needs_release("pending"));
    assert!(delete_needs_release("paid"));
    assert!(delete_needs_release("delivering"));
    assert!(!delete_needs_release("cancelled"));
    assert!(!delete_needs_release("completed"));
}
