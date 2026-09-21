-- 移除 investigations 的反馈状态 CHECK；保留表、数据、字段、索引和外键。
-- 反馈状态继续由应用 scripts/mysql-api.mjs 校验。选择目标库后执行，可重复执行。
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+08:00';
SET @paytrace_drop_feedback_check = (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE investigations DROP CHECK investigations_chk_1',
    'SELECT 1 AS feedback_check_already_absent')
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'investigations'
    AND CONSTRAINT_NAME = 'investigations_chk_1' AND CONSTRAINT_TYPE = 'CHECK'
);
PREPARE paytrace_drop_feedback_stmt FROM @paytrace_drop_feedback_check;
EXECUTE paytrace_drop_feedback_stmt;
DEALLOCATE PREPARE paytrace_drop_feedback_stmt;
INSERT INTO schema_migrations(version) VALUES('20260921000600') ON DUPLICATE KEY UPDATE version=version;
