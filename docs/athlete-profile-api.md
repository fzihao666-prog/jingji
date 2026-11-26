# 竞迹运动员档案页面接口文档

适用版本 `9d1701a`。覆盖 Web「运动员档案」主页面、应用提供的筛选数据和页内子模块。接口以当前服务端实现为准。示例中的运动员 ID、项目和日期需要换成本地演示库或共享测试库中的数据。

## 1. 联调约定

- 本地 API 默认是 `http://127.0.0.1:8787`。同源 Web 请求使用相对路径 `/api/…`，开发环境由 Vite 转发。共享测试环境地址由后端交付。
- 除登录外，本文接口均使用 `Authorization: Bearer <token>`。JSON 写入设置 `Content-Type: application/json`。
- `athleteId` 和运动员路径参数 `:id` 使用数值主键。页面显示的 `athleteNumber` 用于展示与搜索。
- `project` 使用项目字典代码，例如 `ROWING`、`CANOE_SPRINT`、`CANOE_SLALOM`、`VOLLEYBALL`。档案分析优先使用选中运动员对象的 `project`。日期用 `YYYY-MM-DD`，范围含首尾。训练报告有独立周期选择。
- `null` 表示缺失或不可比较，`[]` 表示列表无记录，`0` 可以是实测值。课次的时长和距离还需分别检查 `durationReported` 和 `distanceReported`。
- 普通业务错误通常为 `{ "message": "…" }`，部分响应额外有 `code`。`401 SESSION_EXPIRED` 进入重新登录流程，`403` 表示账号或数据范围不允许，`400` 表示输入校验失败，`404` 见具体接口。遇到 `409` 先按业务重读状态。遇到 `429` 稍后重试。新增课次、伤病和保存报告时避免盲目重发。
- `ATL` 是运动员，`SCC`、`REG`、`TD`、`DMD` 是本文涉及的业务角色，访问仍受账号授权范围限制。`OBS` 只能读取允许的接口和授权队伍的数据。响应可能剔除联系方式、出生地、备注、伤病、来源文件等字段，历史报告的点评返回空数组。前端应允许这些字段缺席。

## 2. 页面加载和接口索引

应用先恢复会话，读取项目偏好、队伍和运动员；档案页选定运动员后并行请求各统计模块。切换运动员或周期时应忽略旧请求的响应。报告模块展开后，阅览账号自动加载历史，其他角色按需打开历史。预览、生成、保存和明细按用户操作调用。

除单独标注外，成功状态为 `200`。

| 模块 | 方法与路径 | 请求要点 | 成功响应 |
|---|---|---|---|
| 登录 | `POST /api/auth/login` | JSON `{username,password}` | `{token,user}` |
| 当前用户 | `GET /api/me` | 无 | `{user}` |
| 项目偏好 | `GET /api/preferences/current-project` | 无 | `{project: string|null, projects: string[]}` |
| 保存项目偏好 | `PUT /api/preferences/current-project` | JSON `{project}` | `{project}` |
| 队伍 | `GET /api/overview/teams` | `project` | `{teams}` |
| 身份与基础档案 | `GET /api/athletes` | 无 | `{athletes: Athlete[]}` |
| 证件照 | `GET /api/athletes/:id/photo` | 无 | JPEG 二进制 |
| 位置或号位 | `PUT /api/athletes/:id/position` | JSON `{athletePosition}` | `{message,athletePosition}` |
| 身体成分 | `GET /api/athletes/:id/body-composition` | 无 | `{history}` |
| 功能筛查、生理生化 | `GET /api/athletes/:id/overview` | `from,to,project` | `{overview}` |
| 训练情况 | `GET /api/athletes/:id/profile-comparison` | `from,to,project` | `{comparison,trainingStatus}` |
| 恢复趋势 | `GET /api/athletes/:id/wellness-trends` | `from,to,project` | `{trends}` |
| 专项和体能雷达 | `GET /api/athletes/:id/radar-models` | 仅 `from,to` | `{special,physical}` |
| 近期专项测试 | `GET /api/special-tests` | `project,from,to,athleteId`，可选 `teamId` | `{events}` |
| 体能测试档案 | `GET /api/strength-tests` | 页面传 `athleteId` | `{tests}` |
| 保存体能测试 | `POST /api/strength-tests` | 见第 5 节 | `{message,id}` |
| Enode 趋势 | `GET /api/enode/data` | 见第 5 节 | 趋势、筛选项及分页数据 |
| 伤病列表 | `GET /api/athletes/:id/injuries` | 无 | `{records}` |
| 新增伤病或疼痛反馈 | `POST /api/athletes/:id/injuries` | 见第 6 节 | `201 {message,record}` |
| 训练记录 | `GET /api/records` | `project,from,to`，可选 `athleteId,teamId` | `{records}` |
| 运动员本人填报 | `POST /api/me/training-sessions` | 课次 JSON，可选 `Idempotency-Key` | `201 {session}` |
| 教练代填 | `POST /api/athletes/:id/training-sessions` | 同一课次 JSON | `201 {session}` |
| 待核实项目归属 | `GET /api/athletes/:id/pending-project-facts` | 无 | `{training,tests}` |
| 确认课次项目 | `POST /api/training-sessions/:id/verify-project` | 课次 ID，JSON `{project}` | `{message}` |
| 确认测试项目 | `POST /api/test-sessions/:id/verify-project` | 测试课次 ID，JSON `{project}` | `{message}` |
| 报告列表 | `GET /api/athletes/:id/reports` | 无 | 历史报告数组 |
| 报告预览 | `GET /api/athletes/:id/reports/preview` | `from,to,kind` | `{data,fingerprint}` |
| 生成 AI 点评 | `POST /api/athletes/:id/reports/commentary` | `{range,fingerprint,consent:true}` | `{highlights,concerns,suggestions}` |
| 保存报告 | `POST /api/athletes/:id/reports` | `{range,fingerprint,commentary,confirmed:true}` | `201 {id,createdAt,data,commentary}` |
| 报告详情 | `GET /api/athletes/:id/reports/:reportId` | 报告 UUID | `{id,createdAt,data,commentary}` |

## 3. 基础档案和证件照

`GET /api/athletes` 返回当前账号有权访问的启用运动员。页面从此列表取档案卡片，按项目与选中运动员筛选。姓名、项目、队伍和教练等来自基础档案。最近一次身体测量也有字段平铺在此对象中，历史记录另行查询。

| 字段组 | 字段与类型 |
|---|---|
| 主键与归属 | `id:number`、`athleteNumber:string`、`name:string`、`project:string`、`teamId:number|null`、`team:string` |
| 教练 | `coaches`、`headCoaches` 为展示字符串，`coachUsers:{id:number,displayName:string}[]` |
| 个人信息 | `gender`、`region`、`province`、`city`、`county`、`ethnicity`、`phone`、`bloodType`、`emergencyContact`、`emergencyPhone`、`education`、`nativePlace`、`homeAddress` 为字符串，`birthDate:string|null` |
| 训练档案 | `technicalLevel`、`athletePosition`、`healthStatus`、`bestResult`、`eventItem`、`representativeUnit`、`bestResultEvent`、`bestResultDate`、`athleteStatus`、`startSportDate`、`trainingVenue`、`currentEvent`、`trainingPhase`、`campPeriod`、`originPlace`、`originUnit`、`originCoach`、`specialties`、`notes` 为字符串，`trainingYears:number|null` |
| 状态和照片 | `profileStatus: 'incomplete'|'complete'`、`source:string`、`hasAccount:number`、`createdAt:string`、`photoUrl:string`。没有照片时 `photoUrl` 为空字符串 |
| 最近身体成分 | 第 4 节的数值字段平铺，另有 `bodyMeasurementDate:string|null`、`bodyMeasurementNote:string` |

队伍筛选查询只传 `project`，返回项为 `{id,project,name,athleteCount}`，其中人数只统计当前账号可访问的启用运动员。保存项目偏好时，非法项目返回 `400`，账号无权选择的项目返回 `403`。

**读取照片。** `photoUrl` 指向受保护接口。带 Bearer 请求后将响应读为 `Blob`，再生成对象 URL；更换照片或卸载时释放。无照片或文件丢失返回 `404`，页面可回退到姓名首字。服务端设置 `Cache-Control: no-store`。

**修改号位。** 档案页只给运动员本人显示编辑入口。服务端按目标运动员授权检查，运动员只能改本人。字符串会清理首尾空白，最多 40 字符，允许空值清除。示例请求 `{"athletePosition":"4号位"}`。成功后重新读取运动员列表。

## 4. 身体成分、功能筛查和训练趋势

### 身体成分历史

`history` 最多 24 条，按 `measurementDate` 降序，日期相同时按记录 ID 降序。查询独立于页面日期范围。元素有 `measurementDate:string`、`note:string`，以及下列允许为 `null` 的数值字段：

| 单位 | 字段 |
|---|---|
| cm | `heightCm` |
| kg | `weightKg`、`skeletalMuscleKg`、`muscleMassKg`、`upperLimbMuscleKg`、`lowerLimbMuscleKg`、`trunkMuscleKg`、`totalBodyWaterKg`、`leftArmLeanKg`、`rightArmLeanKg`、`trunkLeanKg`、`leftLegLeanKg`、`rightLegLeanKg` |
| % | `bodyFatPct` |
| mm | `subcutaneousFatMm`、`tricepsSkinfoldMm`、`abdominalSkinfoldMm`、`thighSkinfoldMm`、`calfSkinfoldMm` |
| 其他 | `visceralFatLevel` 等级、`basalMetabolismKcal` 千卡、`ecwTbwRatio` 比值、`phaseAngleDeg` 度、`visceralFatAreaCm2` 平方厘米 |

### 个人分析

`GET /api/athletes/:id/overview?from=2026-11-01&to=2026-11-07&project=ROWING` 返回通用 `OverviewPayload`。档案页直接消费两个数组：

- `overview.measurements[]` 用于功能动作筛查。元素为 `{code,label,domain,value,target,previous,changePct,unit,quality,source,sampleCount,isDemo}`。四个测量或比较数值可为 `null`，`quality` 可为 `valid`、`partial`、`insufficient`、`outlier`、`estimated`。
- `overview.physiologyRecords[]` 是周期内有效的个人生理生化检测。元素为 `{id,code,label,date,value,unit,source,protocol?}`，`value` 为有限数值。读取原始有效检测记录，不用热力图估算值填补。
- 项目无效或运动员与项目不匹配返回 `400`，超出运动员授权范围返回 `403`。该路由不像恢复趋势或雷达那样严格校验日期，调用方仍应总是传有效日期范围。

### 训练情况与恢复趋势

`profile-comparison` 最长 366 天。无权限或项目与目标不一致返回 `403`，输入无效返回 `400`，达到请求限额返回 `429`。

- `comparison.scope` 和 `trainingStatus.scope` 是 `{athleteId,teamId,project,from,to,athleteCount}`，`teamId` 可空。同队比较以当前授权下同项目同队数据为范围。
- `comparison` 另有 `teamSessionCount` 和 `items[]`。比较项含 `key,label,unit,personalValue,teamMean,difference,teamSampleCount,dateLabel,unavailableReason`。除标识、名称、单位外，比较值或说明可为 `null`。
- 档案训练情况主要读取 `trainingStatus.cards[]`，卡片有 `kind:'physical'|'special'`、`title`、`metrics[]`、`trend`。指标项含 `key,label,unit,personalValue,teamMean,difference,differencePercent,teamSampleCount`。指标键为 `duration`、`load`、`sessionCount`、`distance`、`intensity`。趋势为 `{label,unit,points:[{date,personalValue,teamMean,teamSampleCount}]}`。
- `wellness-trends` 的 `trends[]` 含 `key,label,unit,points`。键为 `rpe`、`sleepHours`、`morningPulse`、`weightKg`、`fatigue`。点为 `{date,personalValue,teamMean,teamSampleCount,hasPersonalValue}`。个人值、团队均值及团队样本数可空。非法日期或项目返回 `400`，范围未授权返回 `403`。

## 5. 雷达、专项测试、体能测试与 Enode

### 专项和体能雷达

严格接受 `from,to` 两个参数，均为合法日期且 `from <= to`。附加 `project`、重复日期参数或非法日期返回 `400`。项目由后端从运动员档案确定。超范围返回 `403`，运动员不可用时可能返回 `404`。

`special` 与 `physical` 都返回 `kind,dimensions,series`：

- `dimensions[]` 每项有 `key,label,unit,direction,currentValue,referenceValue,achievedPercent,signedDifference,status`，部分正式参考维度额外返回 `referenceId`。四项测量或比较数值可为 `null`。`status` 为 `ready`、`measurement_pending` 或 `reference_pending`。
- `series[]` 每项有 `key,label,unit,testType,protocol,protocolVersion,testContext,side,points`，其中 `points[] = {date,value}`。雷达无可比维度时，实测趋势仍可能有数据。非赛艇在正式参考匹配时也可返回体能维度，页面按数组和状态展示，无需依赖 `unavailableReason`。

空响应示例：

```json
{
  "special": { "kind": "special", "dimensions": [], "series": [] },
  "physical": { "kind": "physical", "dimensions": [], "series": [] }
}
```

### 专项测试事件

`GET /api/special-tests` 返回包含目标运动员的成绩，过滤掉无匹配成绩的事件。日期省略时服务端使用宽范围默认值，档案页总是显式传周期。账号无权查看运动员或队伍时返回 `403`，运动员与项目不匹配返回 `400`。

- 事件字段为 `id,project,testDate,distanceM,boatClass,genderGroup,session,windConditions,location,note,results`，还可有 `dataSource,dataQuality`。
- 成绩字段为 `id,rank,crewName,memberAthleteIds,memberNames,previousBestMs,attemptsMs,averageMs,bestMs,deltaPreviousMs,gapLeaderMs`。时间字段单位是毫秒，`previousBestMs` 和 `deltaPreviousMs` 可空。团队成绩的人员数组可包含多个成员。

### 体能测试档案

`GET /api/strength-tests?athleteId=123` 返回该运动员的力量素质测试课次，按测试日期、ID 降序。当前档案请求不附带日期窗口。接口也支持成对的 `from,to`，以及用逗号分隔的 `athleteIds`。参数无效返回 `400`，请求范围中存在未授权运动员返回 `403`。

列表项为 `{id,athleteId,testDate,metrics,targets,notes,updatedAt,updatedBy,protocol,protocolVersion,contextKey,attemptOrder}`。`metrics`、`targets` 是按指标键组织的稀疏数值对象，缺项不补零，键、单位和上下界见 [力量测试指标字典](../shared/strength-model.ts)。

`POST /api/strength-tests` 仅允许有对应运动员权限的 `SCC/REG/TD/DMD`。请求包含 `athleteId,testDate,metrics,targets,notes`，至少提交一项实测。备注最多 500 字符，可选 `protocol`（500 字符）、`protocolVersion`（100 字符）、`contextKey`（500 字符）、`attemptOrder`（整数 1–10000）。未提供协议时使用备注作为协议。同运动员、日期、协议、协议版本、条件和试次的同类测试会更新此次提交的指标。保存成功重新读取测试列表。模块中的体能测试 PDF 由浏览器生成。

### Enode

请求示例 `GET /api/enode/data?athleteId=123&project=ROWING&kind=wellness&from=2026-11-01&to=2026-11-07&metric=wellnessScore&page=1`。

- 必传 `athleteId,project,kind,from,to,metric`。`page` 默认 1，可选 `exercise`、`side`。日期、指标类型或项目无效返回 `400`，无权访问该运动员在该项目的数据返回 `403`。
- 档案页用 `wellness` 和 `sessionRpe`。前者可选 `wellnessScore,stress,mood,sleep,soreness,fatigue`，后者可选 `sessionRpe,trainingLoad,durationMin,sessionCount,volume`。服务端还接受 `measurement`，键和单位见 [Enode 指标字典](../shared/enode.ts)。
- 返回 `selectedExercise,selectedSide,exercises:[{name,count,latest}],sides:string[],daily:[{date,mean,min,max,count}],points:[{date,value}],pointCount,records,total,page,pageSize`。明细一页 50 条，趋势点最多 1000 条，`pointCount` 是抽样前点数。明细为 `{id,recordedAt,exercise,side,values,sourceRow,filename,context}`，来源字段可能因阅览权限而省略。

## 6. 伤病与恢复

`GET /api/athletes/:id/injuries` 最多返回 100 条，按创建时间、ID 降序。记录字段为 `{id,athleteId,recordType,injuryName,bodyPart,side,status,painScore,onsetDate,restrictions,rehabPlan,reviewDate,note,createdBy,creatorRole,createdAt}`。`recordType` 为 `formal` 或 `feedback`，历史 `painScore` 可为 `null`。档案对 `OBS` 隐藏此模块，服务端也拒绝访问。

`POST /api/athletes/:id/injuries` 请求：

| 字段 | 格式 |
|---|---|
| `injuryName`、`bodyPart` | 必填字符串，分别最多 80、30 字符 |
| `side` | `left`、`right`、`bilateral`、`center`、`unspecified`，空值默认 `unspecified` |
| `status` | 正式记录需传 `healthy`、`observation`、`restricted`、`rehab` 或 `suspended` |
| `painScore` | 0–10 的整数 |
| `onsetDate`、`reviewDate` | `YYYY-MM-DD`，前者必填，后者可空 |
| `restrictions`、`rehabPlan`、`note` | 可空字符串，长度上限分别为 500、500、800 |

运动员只可提交本人反馈，服务端固定 `recordType=feedback`、`status=observation`，清空限制和康复计划字段。业务账号在授权范围内提交正式记录。输入不合法返回 `400`，越权返回 `403`。成功 `201`，可用返回的 `record` 更新列表。

## 7. 训练课次与项目归属

### 训练记录读取

`GET /api/records` 是页面训练记录和项目专项展示的共享数据来源。传 `project,from,to`，按需传 `athleteId,teamId`。查询未授权运动员或队伍返回 `403`，项目与明确指定的运动员不符或队伍参数无效返回 `400`。结果为 `{records: TrainingRecord[]}`，按日期、课次顺序、姓名排序，无分页。服务端过滤演示、模拟和部分无效质量记录。

常用字段有 `id,athleteId,athleteName,project,projectCode,projectStatus,activityCode,trainingCategory,intensitySystem,team,date,trainingType,structureType,intensityZone,content,durationMin,distanceKm,durationReported,distanceReported,rpe,srpe,smvl,morningPulse,weightKg,sleepHours,fatigueIndex,status,averageHeartRate,maxHeartRate,averagePowerW,strokeRateSpm,cadenceRpm,trainingBreakdown,updatedAt,updatedBy`。其余地域和展示字段见 [TrainingRecord 类型](../src/types.ts)。`project` 是档案当前项目，`projectCode` 是课次项目，历史课次的项目归属可能仍待核实。

### 新增课次

`ATL` 使用 `POST /api/me/training-sessions` 提交本人课次。业务角色使用 `POST /api/athletes/:id/training-sessions` 为授权运动员代填。两条路径共用严格 JSON 校验。

| 字段 | 格式 |
|---|---|
| `date`、`startTime` | 必填。合法日期，时刻为 24 小时 `HH:mm` 或空字符串 |
| `trainingType`、`content` | 必填。训练类型为 `专项训练`、`体能训练` 或 `恢复训练`，内容 1–500 字符 |
| `duration`、`distance` | 分钟、公里。时长 `>0` 且最多 1440，距离 0–500。至少满足该项目和活动的训练量要求 |
| `rpe` | 可空，0–10 |
| `averageHeartRate`、`maxHeartRate` | 可空，0–250 bpm，同时填写时平均值不超过最大值 |
| `averagePowerW`、`strokeRateSpm`、`cadenceRpm` | 可空，上限分别为 3000 W、100 spm、300 rpm，项目规则另有适用性检查 |
| `intensityZone`、`intensitySystem`、`activityCode`、`rulesVersion` | 可选，长度上限依次为 20、40、40、60。按项目规则提交 |
| `teamPlanId`、`planSessionId` | 计划关联场景可选，分别是正整数和 1–100 字符。档案独立填报不传 |

数值字段支持数字、数字字符串、`null` 或空字符串。示例：

```json
{
  "date": "2026-11-06",
  "startTime": "09:00",
  "trainingType": "体能训练",
  "content": "一般体能训练",
  "duration": 45,
  "rpe": 4
}
```

- 成功 `201 {session}`。至少以 `session.id` 识别新增课次，教练代填返回的课次含 `editable: true`。页面保存成功后刷新数据。
- 本人填报可带 `Idempotency-Key`，16–128 字符，仅字母、数字、下划线、连字符。同一提交重试复用原键，键复用但内容变更返回 `409`。教练代填无此请求头语义。
- `409 CLIENT_RULES_OUTDATED` 时刷新项目规则再提交。当前 Web 表单从共享代码读取规则，独立前端可用 `GET /api/projects/rules?project=…` 读取 `{rules,modules}`。字段适用性见 [项目规则](../shared/sport-rules.ts) 和 [课次校验](../server/athlete/training-session-service.ts)。

### 确认历史数据归属

仅 `SCC/REG/TD/DMD`。待核实查询返回 `training` 和 `tests` 两个数组，每项为 `{id,date,content}`。确认入口中的 `:id` 是记录 ID，提交体只有 `project`。目标项目和原记录均需授权。重复确认相同项目返回 `200`，已确认后改为另一个项目或产生测试业务键冲突返回 `409`。成功后刷新待核实列表及受影响的档案统计。

## 8. 个人训练报告

基础路径 `/api/athletes/:id/reports`。请求授权绑定运动员和该运动员当前项目。报告 ID 使用保存接口返回的 UUID。周期用 `{from,to,kind}`，其中 `kind` 为 `week|month|custom`。自选周期最多 90 天，周报必须周一至周日，月报必须完整自然月。

1. 展开模块或打开历史列表时读取历史。返回顶层数组 `[{id,createdAt,from,to,kind}]`，最新在前，最多 50 条，无分页。
2. 预览时传周期查询参数，返回 `{data,fingerprint}`。`fingerprint` 是 64 位小写十六进制字符串，应与本次预览周期一起保存。
3. 生成点评时发送 `{range,fingerprint,consent:true}`。服务端使用去身份化训练汇总。没有有效训练课次时返回 `400`。成功直接返回 `{highlights,concerns,suggestions}`，前端可修改。
4. 保存时发送 `{range,fingerprint,commentary,confirmed:true}`，三类点评均为字符串数组，每类最多两条，单条最多 100 字符，总计最多 250 字符。支持三类均为空的点评。成功返回 `201` 和报告快照。再次成功保存会创建新报告，提交过程中应禁用重复点击。
5. 打开历史时读 `/:reportId`，响应与保存结果同结构。报告不存在、对象或项目不匹配时返回 `404`。历史数据按保存时快照显示。

| 报告数据字段 | 结构 |
|---|---|
| `version,range,project` | 快照版本、日期范围和项目。兼容 `version=1` 与 `version=2` |
| `totals,previous` | 本期与上一等长区间，各含 `sessions,duration,distance,srpe,durationCount,distanceCount,srpeCount`。时长、距离、负荷可空 |
| `daily` | `{date,sessions,special,physical,recovery,other,duration,srpe}[]`。分类时长、总时长、负荷可空 |
| `categories` | `{key,label,sessions,duration}[]` |
| `tests` | `{key,label,unit,protocol,side,points,first,last,change}[]`。点为 `{date,value}`，变化值可空 |
| `wellness` | `{key,label,unit,days,points,average}[]`。均值可空 |
| 覆盖天数 | `days,trainingDays,wellnessDays` |
| V2 专有字段 | `rulesVersion,referenceVersion,sourceNote,specialty`，其中 `specialty={project,label,status,reason,sessions,duration}`，`status` 为 `available|pending_configuration|unsupported` |

生成或保存返回 `409` 时，重新预览并确认最新数据。点评可能因频控、模型或输出格式返回 `429/503/502`，可以继续使用预览和手工点评。当前 Web 点评请求超时设置为 240 秒。对 `OBS`，只开放报告列表和历史详情，隐藏预览、点评和保存。报告 PDF 有服务端扩展路由 `GET /api/athletes/:id/reports/:reportId/pdf`，受访问控制并返回 `application/pdf`，当前 Web 档案报告组件未发起该请求。

[训练报告运行时 Schema](../shared/training-report.ts) · [训练报告服务端路由](../server/report/report-routes.ts)

## 9. 联调验收

| 场景 | 预期 |
|---|---|
| 教练查看有权限的运动员 | 基础档案、日期分析与训练记录对应同一运动员；项目切换后各区块没有旧数据串入 |
| 合法运动员无记录 | 看到相应空态；雷达维度为空时仍可独立展示实测趋势 |
| 有真实零值与缺失值 | `0` 正常显示，`null` 留空；课次时长和距离尊重上报标记 |
| 有权限账号访问未授权运动员 | 代表性个人接口返回 `403`，页面不残留上次成功数据 |
| 外部阅览 | 验证脱敏字段缺席时档案仍能渲染，伤病入口和报告写入动作不出现 |
| 运动员自评或教练代填 | 成功新增后刷新课次列表；运动员自评重试使用原提交键 |
| 训练报告预览后数据变化 | 服务端返回 `409`，重新预览后才允许继续 |
| 证件照未上传 | 列表 `photoUrl` 为空，页面显示占位；直接请求照片可返回 `404` |

[档案页面调用源](../src/pages/PersonalPage.tsx) · [页面 API 客户端](../src/api.ts) · [应用筛选和训练记录](../src/App.tsx) · [外部阅览权限](../server/core/observer-access.ts)
