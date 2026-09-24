-- 回滚 migrate-idempotency.sql（对标 Medusa db:rollback / Vendure revertLastMigration）
-- ⚠️ 回滚会丢失已存的幂等键（旧单无法再被同键命中），仅在幂等上线出现回归时执行。
DROP INDEX IF EXISTS idx_orders_idempotency;
ALTER TABLE orders DROP COLUMN idempotencyKey;
