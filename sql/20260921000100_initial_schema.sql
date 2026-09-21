-- 变更时间：2026-09-21 00:01:00
-- 目的：MySQL 8.0.16+ 持久化；涉及下列所有业务表与 schema_migrations。
-- 注意：先创建并选择目标数据库（utf8mb4）；不自动创建数据库/账号。仅对空库首次初始化。
-- 可重复执行，不覆盖已有记录；上线前备份。时间由数据库按北京时间（UTC+08:00）写入；业务快照中的 ISO 时间由应用写入。
-- deleted_at 为软删除标志；不级联物理删除。权限/角色本次不实现。
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+08:00';
CREATE TABLE IF NOT EXISTS schema_migrations (
 version VARCHAR(32) PRIMARY KEY COMMENT '已执行迁移编号',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='全局数据库变更记录';
CREATE TABLE IF NOT EXISTS users (
 id CHAR(36) PRIMARY KEY,
 username VARCHAR(60) NOT NULL UNIQUE COMMENT '登录账号',
 display_name VARCHAR(80) NOT NULL,
 password_hash VARCHAR(256) NOT NULL COMMENT 'scrypt 参数、盐与哈希；无明文密码',
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='全局登录用户；角色与权限后续添加';
CREATE TABLE IF NOT EXISTS sessions (
 token_hash CHAR(64) PRIMARY KEY COMMENT 'Cookie 令牌的 SHA256，不存明文令牌',
 user_id CHAR(36) NOT NULL,
 expires_at DATETIME NOT NULL,
 revoked_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (user_id) REFERENCES users(id),
 INDEX idx_session_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户登录会话，退出时撤销，8小时到期';
CREATE TABLE IF NOT EXISTS workspaces (
 id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 name VARCHAR(40) NOT NULL,
 description VARCHAR(300) NOT NULL DEFAULT '',
 businesses JSON NOT NULL COMMENT '业务线名称数组',
 created_by CHAR(36) NULL COMMENT '初始化空间无创建人；用户创建时记录',
 deleted_at DATETIME NULL,
 live_name VARCHAR(40) GENERATED ALWAYS AS (IF(deleted_at IS NULL,name,NULL)) STORED,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_workspace_name(live_name),
 FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='共享业务空间；业务数据按空间隔离，暂不做成员权限';
CREATE TABLE IF NOT EXISTS workspace_knowledge (
 workspace_id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 payload JSON NOT NULL COMMENT 'Markdown、扫描开关、兼容旧项目路径配置及保存时间',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='空间知识文档，一空间一份，空文档也是有效内容';
CREATE TABLE IF NOT EXISTS investigations (
 id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 workspace_id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 transaction_id VARCHAR(200) NOT NULL COMMENT '搜索标识，不表示已查询交易数据库',
 revision INT UNSIGNED NOT NULL DEFAULT 0,
 feedback_status VARCHAR(20) NULL COMMENT '已解决/需要开发介入/判断不正确',
 payload JSON NOT NULL COMMENT '完整报告：问题、证据与上下文、查询覆盖、AI结果、反馈及补证',
 deleted_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
 INDEX idx_report_history(workspace_id,deleted_at,created_at),
 INDEX idx_report_transaction(workspace_id,transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='空间排查记录，JSON保留证据快照以兼容报告结构';
CREATE TABLE IF NOT EXISTS projects (
 id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workspace_id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(80) NOT NULL,
 payload JSON NOT NULL COMMENT '业务配置快照；不包含密码和API Key',
 deleted_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_projects_active(workspace_id,deleted_at),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='空间项目配置及最后一次成功的业务链路分析快照';
CREATE TABLE IF NOT EXISTS log_sources (
 id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workspace_id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(80) NOT NULL,
 payload JSON NOT NULL COMMENT '业务配置快照；不包含密码和API Key',
 secret_cipher TEXT NULL COMMENT 'AES-256-GCM 凭据密文',
 deleted_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_log_sources_active(workspace_id,deleted_at),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='空间SSH服务器配置，payload包括日志规则和最近检查结果';
CREATE TABLE IF NOT EXISTS model_providers (
 id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 name VARCHAR(80) NOT NULL,
 payload JSON NOT NULL COMMENT '业务配置快照；不包含密码和API Key',
 secret_cipher TEXT NULL COMMENT 'AES-256-GCM 凭据密文',
 deleted_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_model_providers_active(deleted_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='全局模型服务商配置，由所有空间共享';
CREATE TABLE IF NOT EXISTS app_settings (
 id TINYINT UNSIGNED PRIMARY KEY,
 active_model_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CHECK (id=1),
 FOREIGN KEY (active_model_id) REFERENCES model_providers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='全局运行配置，唯一一行记录当前启用模型';
INSERT INTO app_settings(id) VALUES(1) ON DUPLICATE KEY UPDATE id=id;
INSERT INTO schema_migrations(version) VALUES('20260921000100') ON DUPLICATE KEY UPDATE version=version;
