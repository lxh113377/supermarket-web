# 07 分卷 110 —— 第五十六轮的一条改判（自卷 106 整节迁出）

> 拆卷原因：V4「出生即贴线」。R57 登记六项在卷 106，本卷是那条被本轮实测推翻的缺口。

## 一条改判：收付款对账**不该按原计划做**

第五十五轮把"收付款对账"列为同域三缺口之一。本轮实测对手方：`gh api` 代码面搜
`repo:opensourcepos/opensourcepos ospos_payments` ⇒ **total_count=0**；grocy 搜 `stock_transactions` 亦 0 命中
（两者都只搜默认分支，0 是"该查询取不到"而不是"该功能不存在"，故按"证据不足"处理而非"确证没有"）。
⇒ 这一条从"缺口"降为"待取证"：ERPNext/Odoo 有 `accounts` 是因为它们是 ERP，单店 POS 的同类里没人做。
