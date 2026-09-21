-- 仅在 investigations 为空且没有其他表外键引用它时执行；会删除并重建该表。
-- 保留字段注释、索引及空间外键；反馈状态由应用校验，不创建 CHECK。
-- DDL 隐式提交，无法事务回滚；先选择目标数据库。
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+08:00';
DROP TABLE investigations;
CREATE TABLE investigations (
 id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '排查报告 ID，与 workspace_id 组成联合主键，区分大小写',
 workspace_id VARCHAR(84) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属空间 ID，关联 workspaces.id，并与 id 组成联合主键',
 transaction_id VARCHAR(200) NOT NULL COMMENT '排查输入的交易号或搜索标识；不代表已经查询交易数据库',
 revision INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '报告证据版本号，初始为 0；AI 分析提交时校验报告 JSON 中的版本',
 feedback_status VARCHAR(20) NULL COMMENT '处理反馈状态：已解决、需要开发介入、判断不正确；NULL 表示未反馈',
 payload JSON NOT NULL COMMENT '完整排查报告 JSON：交易搜索信息、问题、证据与上下文、查询覆盖、revision 证据版本、AI 结果、反馈及补证快照',
 deleted_at DATETIME NULL COMMENT '软删除时间，北京时间（UTC+08:00）；NULL 表示未归档，归档保留原始数据',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间，北京时间（UTC+08:00）',
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间，北京时间（UTC+08:00），记录变更时自动更新',
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
 INDEX idx_report_history(workspace_id,deleted_at,created_at),
 INDEX idx_report_transaction(workspace_id,transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='空间排查记录，JSON保留证据快照以兼容报告结构';
