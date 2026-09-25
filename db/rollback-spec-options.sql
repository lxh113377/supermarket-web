-- 回滚：撤销 specOptions 列（2026-09-25 可选规格迁移）
-- 仅在确认「已回退到不引用该列的前端/后端版本」之后执行；DROP 后口味数据不可恢复。
-- 执行方式：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/rollback-spec-options.sql --remote
ALTER TABLE products DROP COLUMN specOptions;
