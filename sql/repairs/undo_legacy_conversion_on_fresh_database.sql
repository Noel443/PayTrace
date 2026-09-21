-- 专用于：空库依次执行 initial_schema、initial_data、legacy_utc_to_beijing，且尚未使用应用。
-- 先备份并选择目标数据库；停止应用，单独完整执行。不要与其他 SQL 并发执行。
-- 仅恢复初始化记录；删除误执行的迁移标记后，再次执行不会重复减 8 小时。
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+08:00';
START TRANSACTION;
SET @repair_fresh_database = (
  EXISTS (SELECT 1 FROM schema_migrations WHERE version = '20260921000300')
  AND (SELECT COUNT(*) FROM schema_migrations) = 3
  AND (SELECT COUNT(*) FROM schema_migrations WHERE version IN ('20260921000100', '20260921000200')) = 2
  AND (SELECT COUNT(*) FROM users) = 1
  AND EXISTS (SELECT 1 FROM users WHERE id = '00000000-0000-4000-8000-000000000001' AND username = 'admin')
  AND (SELECT COUNT(*) FROM workspaces) = 3
  AND (SELECT COUNT(*) FROM workspaces WHERE id IN ('card', 'cross-border', 'hk-cb') AND deleted_at IS NULL) = 3
  AND NOT EXISTS (SELECT 1 FROM sessions)
  AND NOT EXISTS (SELECT 1 FROM workspace_knowledge)
  AND NOT EXISTS (SELECT 1 FROM investigations)
  AND NOT EXISTS (SELECT 1 FROM projects)
  AND NOT EXISTS (SELECT 1 FROM log_sources)
  AND NOT EXISTS (SELECT 1 FROM model_providers)
  AND NOT EXISTS (SELECT 1 FROM app_settings)
);
UPDATE users
SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR),
    updated_at = DATE_SUB(updated_at, INTERVAL 8 HOUR)
WHERE @repair_fresh_database = 1 AND id = '00000000-0000-4000-8000-000000000001';
UPDATE workspaces
SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR),
    updated_at = DATE_SUB(updated_at, INTERVAL 8 HOUR)
WHERE @repair_fresh_database = 1 AND id IN ('card', 'cross-border', 'hk-cb');
UPDATE schema_migrations
SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR),
    updated_at = DATE_SUB(updated_at, INTERVAL 8 HOUR)
WHERE @repair_fresh_database = 1 AND version IN ('20260921000100', '20260921000200');
DELETE FROM schema_migrations
WHERE @repair_fresh_database = 1 AND version = '20260921000300';
COMMIT;
SELECT IF(@repair_fresh_database = 1,
  'REPAIRED: initialization timestamps restored',
  'SKIPPED: already repaired or database does not match unused initialization') AS repair_result;
SELECT version, created_at, updated_at FROM schema_migrations ORDER BY version;
