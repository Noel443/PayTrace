-- 变更时间：2026-09-21 00:03:00
-- 目的：将旧 UTC 库的 DATETIME 转为北京时间；涉及全部 10 张应用表。
-- 仅适用于旧版 +00:00 脚本和应用写入的数据库；新建 +08:00 库禁止执行。
-- 执行前停止应用并备份，确认没有混入北京时间记录。JSON 内 ISO 时间不修改。
-- 在事务中整体转换并记录版本，重复执行不再次加 8 小时；勿与其他迁移并发执行。
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+08:00';
START TRANSACTION;
SET @convert_legacy_utc = NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='20260921000300');
UPDATE schema_migrations SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
UPDATE users SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
UPDATE sessions SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR), expires_at=DATE_ADD(expires_at,INTERVAL 8 HOUR), revoked_at=DATE_ADD(revoked_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
UPDATE workspaces SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR), deleted_at=DATE_ADD(deleted_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
UPDATE workspace_knowledge SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
UPDATE investigations SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR), deleted_at=DATE_ADD(deleted_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
UPDATE projects SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR), deleted_at=DATE_ADD(deleted_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
UPDATE log_sources SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR), deleted_at=DATE_ADD(deleted_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
UPDATE model_providers SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR), deleted_at=DATE_ADD(deleted_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
UPDATE app_settings SET created_at=DATE_ADD(created_at,INTERVAL 8 HOUR), updated_at=DATE_ADD(updated_at,INTERVAL 8 HOUR) WHERE @convert_legacy_utc = 1;
INSERT INTO schema_migrations(version) VALUES('20260921000300') ON DUPLICATE KEY UPDATE version=version;
COMMIT;

