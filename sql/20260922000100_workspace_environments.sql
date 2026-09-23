-- 变更时间：2026-09-22 00:01:00
-- 目的：同一应用库区分测试和生产空间；配置、知识及报告沿用 workspace_id 外键隔离。
-- 涉及：workspaces 新增 environment 字段；schema_migrations 记录版本。
-- 先执行 initial_schema 和 initial_data；备份后执行，可重复执行，不覆盖已有业务数据。
-- 旧空间默认归属 test。生产初始化为空空间，不复制 SSH 凭据、项目或排查报告。
-- 模型服务商与登录账号仍全局共用；此环境划分不是用户权限边界。
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+08:00';
SET @paytrace_env_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='workspaces' AND COLUMN_NAME='environment'),
  'SELECT 1',
  'ALTER TABLE workspaces ADD COLUMN environment VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''test'' COMMENT ''所属环境：test / production；配置及报告继承空间环境'', ADD INDEX idx_workspace_environment(environment,deleted_at)'
);
PREPARE paytrace_env_stmt FROM @paytrace_env_ddl;
EXECUTE paytrace_env_stmt;
DEALLOCATE PREPARE paytrace_env_stmt;
START TRANSACTION;
INSERT INTO workspaces(id,name,description,businesses,environment) VALUES
 ('ws-production-card','外卡支付（生产）','生产日志与排查记录；请配置真实数据源',JSON_ARRAY('外卡收单'),'production'),
 ('ws-production-cross-border','跨境支付（生产）','生产日志与排查记录；请配置真实数据源',JSON_ARRAY('跨境支付'),'production'),
 ('ws-production-hk-cb','MSO（生产）','生产日志与排查记录；请配置真实数据源',JSON_ARRAY('MSO'),'production')
ON DUPLICATE KEY UPDATE id=id;
INSERT INTO schema_migrations(version) VALUES('20260922000100') ON DUPLICATE KEY UPDATE version=version;
COMMIT;
