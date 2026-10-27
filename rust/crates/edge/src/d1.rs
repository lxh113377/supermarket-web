//! Cloudflare D1 的 HTTP API 客户端（健康探活 + （可选）原生读）。
//!
//! ## 为什么走 HTTP API 而不是直连 sqlite
//!
//! 数据面的**唯一真相**在 D1（Cloudflare 的托管 SQLite）。边缘服务若另接一个本地
//! SQLite 副本，就要自己解决「复制 + 一致性 + 写回」，那不是这次重写的目标，
//! 而且会让「数据格式保持不变」这条契约多出一个中间层。
//! D1 的 HTTP API 让边缘与现网 Functions 对**同一份数据**读写同一个 schema：
//! 契约零漂移，代价是每次查询一次 HTTPS 往返（本地读写路径不依赖它，见 docs/04）。

use std::time::Duration;

#[derive(Clone)]
pub struct D1Client {
    account_id: String,
    database_id: String,
    api_token: String,
    /// 见 `D1Config::api_base`：仅本机 mock 链路测试会设它。
    api_base: Option<String>,
    http: reqwest::Client,
}

impl D1Client {
    pub fn new(cfg: &crate::config::D1Config) -> D1Client {
        D1Client {
            account_id: cfg.account_id.clone(),
            database_id: cfg.database_id.clone(),
            api_token: cfg.api_token.clone(),
            api_base: cfg.api_base.clone(),
            // 探活必须「快速失败」：健康端点等 10 秒才回 500，等于探活本身变成了故障源。
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .expect("reqwest client 构建失败（TLS 后端不可用）"),
        }
    }

    fn endpoint(&self) -> String {
        // 基址可覆盖（D1_API_BASE）：本机 mock 链路测试用；不设即官方端点。
        let base = self
            .api_base
            .clone()
            .unwrap_or_else(|| "https://api.cloudflare.com/client/v4".to_string());
        format!(
            "{}/accounts/{}/d1/database/{}/query",
            base.trim_end_matches('/'),
            self.account_id,
            self.database_id
        )
    }

    /// 执行一条 SQL，返回 D1 的 `result` 数组（原样，不重排字段）。
    pub async fn query(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<serde_json::Value, String> {
        let body = serde_json::json!({ "sql": sql, "params": params });
        let resp = self
            .http
            .post(self.endpoint())
            .bearer_auth(&self.api_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("D1 请求失败：{}", e))?;
        let status = resp.status();
        let value: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("D1 响应不是 JSON：{}", e))?;
        if !status.is_success() || value.get("success").and_then(|s| s.as_bool()) != Some(true) {
            return Err(format!("D1 返回错误状态 {}：{}", status, value));
        }
        Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null))
    }

    /// 执行一条**查询**并取出第一段结果的行数组（D1 HTTP 的形状是
    /// `{success, result: [{results: [...], success, meta}, ...]}`）。
    ///
    /// 形状不对时返回 Err（调用方据此回落透传）：宁可少一次原生命中，
    /// 也不要把「没取到行」当成「表里没有行」——后者会让前端显示空目录。
    pub async fn query_rows(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<Vec<serde_json::Value>, String> {
        let result = self.query(sql, params).await?;
        let rows = result
            .get(0)
            .and_then(|r| r.get("results"))
            .and_then(|r| r.as_array())
            .cloned()
            .ok_or_else(|| format!("D1 返回形状不含 result[0].results：{}", result))?;
        Ok(rows)
    }

    /// `SELECT 1`：`/_health` 的 db 字段判据（与现网 `functions/_health.js` 同一条 SQL）。
    pub async fn ping(&self) -> bool {
        self.query("SELECT 1 AS ok", &[]).await.is_ok()
    }
}
