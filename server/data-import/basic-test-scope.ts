// 调用方须先校验当前项目和队伍权限。新批次用队伍 ID，旧批次使用上传时记录的队名。
const summary = "CASE WHEN json_valid(b.summary_json) THEN b.summary_json ELSE '{}' END";
export const basicTestInTeam = `(
  (m.source_ref LIKE '体能与专项测试!%' OR m.source_ref LIKE '功能筛查!%') AND (
    json_extract(${summary}, '$.teamId')=team.id OR
    (json_extract(${summary}, '$.teamId') IS NULL AND json_extract(${summary}, '$.team')=team.name)
  )
)`;
