//! `dist/_headers` 的解析与应用。
//!
//! 为什么不让边缘服务自己写一套缓存规则：**缓存策略在同一份产物里有第二处声明**
//! （Cloudflare Pages 的 `_headers`），而现网 CI 用 `check-cache-headers` 把那份声明
//! 与实际响应双向对账。边缘若另写一张表，两端就会漂移 —— 于是这里直接**读那份声明**，
//! 「边缘发的头」与「Pages 发的头」在物理上同源。
//!
//! 支持 Cloudflare `_headers` 的两种模式：`/*`（全局）、`/prefix/*`（前缀）、`/path`（精确）。

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Rule {
    pub pattern: String,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Default)]
pub struct Policy {
    pub global: Vec<(String, String)>,
    pub rules: Vec<Rule>,
    /// 路径 → 该路径专属头（按文件里最后匹配的规则覆盖，与 Cloudflare 的「后者优先」一致）
    pub by_path: HashMap<String, Vec<(String, String)>>,
}

impl Policy {
    /// 解析 `_headers` 文本。注释（#）与空行忽略。
    pub fn parse(text: &str) -> Policy {
        let mut policy = Policy::default();
        let mut current: Option<String> = None;
        for raw in text.lines() {
            let line = raw.trim_end();
            if line.trim().is_empty() || line.trim_start().starts_with('#') {
                continue;
            }
            // 规则行：顶格（无缩进）；头行：以空白缩进
            if !line.starts_with(' ') && !line.starts_with('\t') {
                let pattern = line.trim().to_string();
                if pattern == "/*" {
                    current = Some("/*".to_string());
                } else {
                    current = Some(pattern.clone());
                    policy.rules.push(Rule { pattern, headers: Vec::new() });
                }
                continue;
            }
            let Some((name, value)) = line.trim().split_once(':') else {
                continue;
            };
            let pair = (name.trim().to_string(), value.trim().to_string());
            match current.as_deref() {
                Some("/*") => policy.global.push(pair),
                Some(_) => {
                    if let Some(rule) = policy.rules.last_mut() {
                        rule.headers.push(pair);
                    }
                }
                None => {}
            }
        }
        policy.by_path.clear();
        policy
    }

    /// 命中某路径的所有头（全局 + 该路径的所有匹配规则，后者覆盖前者的同名头）。
    pub fn headers_for(&self, path: &str) -> Vec<(String, String)> {
        let mut merged: Vec<(String, String)> = self.global.clone();
        for rule in &self.rules {
            if pattern_matches(&rule.pattern, path) {
                for (k, v) in &rule.headers {
                    merged.retain(|(mk, _)| !mk.eq_ignore_ascii_case(k));
                    merged.push((k.clone(), v.clone()));
                }
            }
        }
        merged
    }
}

/// `/assets/*` ⇒ 前缀匹配；`/index.html` ⇒ 精确匹配。
pub fn pattern_matches(pattern: &str, path: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) => path.starts_with(prefix),
        None => pattern == path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"/*
  X-Frame-Options: DENY

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: public, max-age=0, must-revalidate
"#;

    #[test]
    fn parses_global_and_path_rules() {
        let p = Policy::parse(SAMPLE);
        assert_eq!(p.global.len(), 1);
        assert_eq!(p.rules.len(), 2);
        let assets = p.headers_for("/assets/index-abc.js");
        assert!(assets.iter().any(|(k, v)| k == "Cache-Control" && v.contains("immutable")));
        assert!(assets.iter().any(|(k, _)| k == "X-Frame-Options"), "全局头必须仍然生效");
        let html = p.headers_for("/index.html");
        assert!(html.iter().any(|(k, v)| k == "Cache-Control" && v.contains("must-revalidate")));
    }

    #[test]
    fn later_rule_overrides_same_header() {
        let text = "/*\n  X: 1\n/a/*\n  X: 2\n";
        let p = Policy::parse(text);
        let h = p.headers_for("/a/b");
        assert_eq!(h.iter().filter(|(k, _)| k == "X").count(), 1);
        assert!(h.iter().any(|(k, v)| k == "X" && v == "2"));
    }
}
