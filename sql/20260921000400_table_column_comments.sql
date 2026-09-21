-- 变更时间：2026-09-21 00:04:00
-- 目的：补齐 10 张表、64 个字段的 COMMENT，明确字段含义、空间归属及凭据用途。
-- 适用：MySQL 8.0.16+，表结构与 20260921000100_initial_schema.sql 一致的现有库。
-- 执行前选择目标库（例如 USE paytrace;），备份并在低峰执行；ALTER TABLE 会获取元数据锁。
-- 仅修改注释，保留字段类型、可空性、默认值、生成列表达式、字符集及现有索引/外键/CHECK。
-- DDL 隐式提交，不使用事务包装；客户端遇错应停止，修复后可重复执行完整脚本。
-- 本脚本不依赖旧 UTC 时间转换脚本，不需要执行 20260921000300；不转换任何业务时间。
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+08:00';

ALTER TABLE schema_migrations
  MODIFY COLUMN version VARCHAR(32) NOT NULL COMMENT '已成功执行的 SQL 迁移编号；主键，对应迁移脚本编号',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '全局数据库变更记录';

ALTER TABLE users
  MODIFY COLUMN id CHAR(36) NOT NULL COMMENT '用户唯一标识，主键',
  MODIFY COLUMN username VARCHAR(60) NOT NULL COMMENT '登录账号，全局唯一',
  MODIFY COLUMN display_name VARCHAR(80) NOT NULL COMMENT '用户显示名称',
  MODIFY COLUMN password_hash VARCHAR(256) NOT NULL COMMENT '登录密码的 scrypt 参数、盐及哈希，不保存明文密码',
  MODIFY COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '账号启用状态：1 启用，0 禁用',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '全局登录用户；角色与权限后续添加';

ALTER TABLE sessions
  MODIFY COLUMN token_hash CHAR(64) NOT NULL COMMENT 'Cookie 登录令牌的 SHA-256 十六进制摘要，主键；不保存明文令牌',
  MODIFY COLUMN user_id CHAR(36) NOT NULL COMMENT '登录用户 ID，关联 users.id',
  MODIFY COLUMN expires_at DATETIME NOT NULL COMMENT '会话到期时间，北京时间（UTC+08:00）；登录后有效期 8 小时',
  MODIFY COLUMN revoked_at DATETIME NULL COMMENT '会话撤销时间，北京时间（UTC+08:00）；NULL 表示未撤销，退出或修改密码时撤销',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '用户登录会话，退出时撤销，8小时到期';

ALTER TABLE workspaces
  MODIFY COLUMN id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '工作空间唯一标识，主键，区分大小写',
  MODIFY COLUMN name VARCHAR(40) NOT NULL COMMENT '工作空间名称，未归档空间内名称唯一',
  MODIFY COLUMN description VARCHAR(300) NOT NULL DEFAULT '' COMMENT '工作空间说明，默认空字符串',
  MODIFY COLUMN businesses JSON NOT NULL COMMENT '业务线名称 JSON 数组',
  MODIFY COLUMN created_by CHAR(36) NULL COMMENT '创建用户 ID，关联 users.id；初始化或导入空间可为空',
  MODIFY COLUMN deleted_at DATETIME NULL COMMENT '软删除时间，北京时间（UTC+08:00）；NULL 表示未归档，归档保留原始数据',
  MODIFY COLUMN live_name VARCHAR(40) GENERATED ALWAYS AS (IF(deleted_at IS NULL,name,NULL)) STORED COMMENT '自动生成的有效空间名称：未归档时取 name，归档后为 NULL；用于唯一索引，禁止手动赋值',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '共享业务空间；业务数据按空间隔离，暂不做成员权限';

ALTER TABLE workspace_knowledge
  MODIFY COLUMN workspace_id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属空间 ID，主键并关联 workspaces.id；每个空间最多一份文档',
  MODIFY COLUMN payload JSON NOT NULL COMMENT '知识配置 JSON：markdown 业务文档、scanEnabled 扫描开关、projects 兼容旧项目路径、updatedAt 保存时间；空文档有效',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '空间知识文档，一空间一份，空文档也是有效内容';

ALTER TABLE investigations
  MODIFY COLUMN id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '排查报告 ID，与 workspace_id 组成联合主键，区分大小写',
  MODIFY COLUMN workspace_id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属空间 ID，关联 workspaces.id，并与 id 组成联合主键',
  MODIFY COLUMN transaction_id VARCHAR(200) NOT NULL COMMENT '排查输入的交易号或搜索标识；不代表已经查询交易数据库',
  MODIFY COLUMN revision INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '报告证据版本号，初始为 0；AI 分析提交时校验报告 JSON 中的版本',
  MODIFY COLUMN feedback_status VARCHAR(20) NULL COMMENT '处理反馈状态：已解决、需要开发介入、判断不正确；NULL 表示未反馈',
  MODIFY COLUMN payload JSON NOT NULL COMMENT '完整排查报告 JSON：交易搜索信息、问题、证据与上下文、查询覆盖、revision 证据版本、AI 结果、反馈及补证快照',
  MODIFY COLUMN deleted_at DATETIME NULL COMMENT '软删除时间，北京时间（UTC+08:00）；NULL 表示未归档，归档保留原始数据',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '空间排查记录，JSON保留证据快照以兼容报告结构';

ALTER TABLE projects
  MODIFY COLUMN id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '项目配置唯一标识，主键，区分大小写',
  MODIFY COLUMN workspace_id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属空间 ID，关联 workspaces.id',
  MODIFY COLUMN name VARCHAR(80) NOT NULL COMMENT '项目显示名称',
  MODIFY COLUMN payload JSON NOT NULL COMMENT '项目配置 JSON：仓库类型、本地路径或远程地址、分支、关注点、扫描开关、配置版本及最后成功的链路分析快照；不保存密码或 API Key',
  MODIFY COLUMN deleted_at DATETIME NULL COMMENT '软删除时间，北京时间（UTC+08:00）；NULL 表示未归档，归档保留原始数据',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '空间项目配置及最后一次成功的业务链路分析快照';

ALTER TABLE log_sources
  MODIFY COLUMN id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '日志数据源唯一标识，主键，区分大小写',
  MODIFY COLUMN workspace_id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属空间 ID，关联 workspaces.id',
  MODIFY COLUMN name VARCHAR(80) NOT NULL COMMENT '日志数据源显示名称',
  MODIFY COLUMN payload JSON NOT NULL COMMENT 'SSH 数据源配置 JSON：主机、端口、账号、环境、日志目录、日志规则、启用状态及最近检查结果；不包含 SSH 密码',
  MODIFY COLUMN secret_cipher TEXT NULL COMMENT 'SSH 登录密码的 AES-256-GCM 密文，Base64 编码包含随机 IV、认证标签及密文；NULL 表示未保存密码',
  MODIFY COLUMN deleted_at DATETIME NULL COMMENT '软删除时间，北京时间（UTC+08:00）；NULL 表示未归档，归档保留原始数据',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '空间SSH服务器配置，payload包括日志规则和最近检查结果';

ALTER TABLE model_providers
  MODIFY COLUMN id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '模型服务商唯一标识，主键，区分大小写；所有空间共享',
  MODIFY COLUMN name VARCHAR(80) NOT NULL COMMENT '模型服务商显示名称',
  MODIFY COLUMN payload JSON NOT NULL COMMENT '模型配置 JSON：provider 接口类型、base 接口根地址、model 模型名、enabled 可用状态及标识名称；不包含 API Key，当前选用关系在 app_settings',
  MODIFY COLUMN secret_cipher TEXT NULL COMMENT '模型 API Key 的 AES-256-GCM 密文，Base64 编码包含随机 IV、认证标签及密文；NULL 表示未保存密钥',
  MODIFY COLUMN deleted_at DATETIME NULL COMMENT '软删除时间，北京时间（UTC+08:00）；NULL 表示未归档，归档保留原始数据',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '全局模型服务商配置，由所有空间共享';

ALTER TABLE app_settings
  MODIFY COLUMN id TINYINT UNSIGNED NOT NULL COMMENT '全局设置单行主键，CHECK 约束限定为 1',
  MODIFY COLUMN active_model_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '当前启用模型服务商 ID，关联 model_providers.id；NULL 表示未启用模型',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
  COMMENT = '全局运行配置，唯一一行记录当前启用模型';

-- 全部 ALTER 成功后记录迁移编号；重复执行不修改已有迁移记录。
INSERT INTO schema_migrations(version) VALUES('20260921000400') ON DUPLICATE KEY UPDATE version=version;

-- 执行后可使用以下只读查询检查遗漏；预期返回 0 行。
-- SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA = DATABASE()
--   AND TABLE_NAME IN ('schema_migrations','users','sessions','workspaces','workspace_knowledge',
--                      'investigations','projects','log_sources','model_providers','app_settings')
--   AND COLUMN_COMMENT = '';
