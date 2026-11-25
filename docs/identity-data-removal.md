# 身份证信息移除操作说明

系统不再把身份证作为资料字段、搜索项或导入导出列。出生日期和性别独立维护，年龄从生日计算，运动员与账号仍通过内部 ID 关联。

## 清理范围

- 正式列：`registration_requests.identity_number`、`athlete_profiles.identity_number`。
- 历史结构化内容：所有数据库 JSON 列及审计详情内明确的身份证键，递归移除；其它字段保留。
- 自由文本：清理可识别且生日、校验位有效的 18 位号码，跳过 ID、哈希、凭据等业务标识。此规则不能证明任意拼接、遮盖或错误号码均已清除，须结合导出文件与业务记录保留策略复核。
- 新库不创建相关列。旧库启动遇到相关列时会阻断，防止在未经确认时自动删除。
- 导入旧模板时相关列被忽略，不进入暂存 payload；公开模板、导出文件使用新字段集。

## 只读检查

以下工具不读取 `.env`，不导入业务数据库模块，必须提供现有数据库的显式路径。默认只输出结构元信息；`--audit` 在库内检查并只输出数量，不打印业务值。

```sh
node --import tsx scripts/remove-identity-data.ts --database /absolute/path/training-monitor.db
node --import tsx scripts/remove-identity-data.ts --database /absolute/path/training-monitor.db --audit
```

## 确认与维护窗口

执行前由用户一次确认目标主库、项目管理范围内的历史文件清理清单，以及备份保留和销毁规则。没有确认不得执行下述写操作。确认本地文件不等于确认远端生产服务器、云盘、邮件附件或外部快照。

1. 停止所有访问该库的应用、定时任务和写入进程；核实数据库路径、磁盘空间和 SQLite 版本（至少 3.35）。不使用运行中的文件复制作为一致性备份。
2. 为本次恢复备份选择专用受控目录。工具创建权限 0700 的目录、0600 的随机独占备份文件，通过 `VACUUM INTO` 备份 WAL 已提交数据并校验完整性和外键。
3. 运行经确认的迁移命令。工具在 `BEGIN IMMEDIATE` 中清除历史内容、删除列、验证业务行标识、完整性与外键，并在 `app_metadata` 写入 `identity_removal_v1`；失败回滚。未知结构依赖或无效 JSON 会阻断，不能强行跳过。

```sh
node --import tsx scripts/remove-identity-data.ts \
  --database /absolute/path/training-monitor.db \
  --backup-dir /restricted/path/identity-removal-backups \
  --apply --writers-stopped
```

4. 提交后执行 `wal_checkpoint(TRUNCATE)`、`VACUUM`、再次 checkpoint 和完整性检查。若整理失败，迁移可能已经提交；保持停写，使用独立整理命令重试，不能误判为事务已回滚。

```sh
node --import tsx scripts/remove-identity-data.ts \
  --database /absolute/path/training-monitor.db \
  --compact-only --writers-stopped
```

5. 再次只读检查列、历史键计数、完整性与外键；启动新应用，验证注册、登录、资料编辑、生日和性别回显、年龄、账号关联及训练测试数据。登记迁移结果，不记录个人信息值。

## 文件与备份

本地元信息扫描发现主库、`data/backups/` 多份历史备份、旧重建快照、测试/演示库，以及 `outputs/` 中的模板、带数据工作簿和检查产物。公开统一导入模板及两份输出工作簿包含旧表头或说明。仅凭文件名不能认定是空白或不含真实数据。

- 主库、非备份旧库副本、CSV/Excel/JSON/日志分别登记路径、类型和清理方式；不输出身份证值。
- 历史带数据工作簿只删除身份证列、相关说明及明确副本，保留其它业务单元格。不能用空白模板覆盖带数据工作簿。
- 本次新备份也包含原始身份证信息；权限限制不等于加密。根据用户确认的用途、负责人、保留期限及加密/销毁要求独立管理。
- 原有生产备份、审计归档与外部快照不得自动批量删除。逐项明确保留、清洗或销毁；恢复旧备份会重新引入身份证，须重新迁移后才能启动新应用。
- Git 历史和已分发的旧导出不因当前工作区修改而消失。若历史中确有真实个人信息，应单独安排历史清理与副本回收，未经授权不重写 Git 历史。
- SQLite 整理只处理当前库及 WAL 的逻辑残留，不能证明 SSD、文件系统快照或外部备份已物理擦除。

历史文件工具 `scripts/remove-identity-files.py` 必须逐个指定文件，默认仅预览计数。使用具备 `openpyxl` 的 Python 环境处理 XLSX；普通 CSV/JSON/NDJSON 清理使用标准库，不添加应用依赖。测试环境可通过 `JINGJI_FILE_CLEANUP_PYTHON` 指定 Python。

```sh
python3 scripts/remove-identity-files.py --file /absolute/path/history.xlsx
# 仅在用户确认范围、停用相关产物后追加：
python3 scripts/remove-identity-files.py --file /absolute/path/history.xlsx \
  --apply --confirmed --backup-dir /restricted/path/identity-file-backups
```

工具保留其它单元格数据，支持合并标题、常量列表与日期验证的安全列移动。公式、图表、条件格式、表格、非字面验证及无法确定语义的混合文本会阻断；不得为了通过清理而静默删掉这些业务内容。图片、XML 和数据库归档不由该工具处理。派生检查文件和截图可以在确认后删除并重新生成，带业务数据的工作簿须清洗，不能用空表覆盖。

## 验证与回滚

使用隔离临时库测试新旧 schema、重复执行、坏 JSON 回滚、外键/索引/业务 ID 保留、WAL 一致性备份及整理失败重试。运行项目既有 `check`、`lint`、`test`、`build`、`mini:typecheck`、`mini:dictionary-check`、`api-check`、`database-lock-check`。

事务失败直接回滚。提交后若需恢复，只能在维护窗口使用经校验的备份及兼容旧应用，并明确授权；恢复会重新引入身份证，且可能覆盖迁移后新增业务数据，不能直接覆盖运行中的库。

## 2026-10-12 本地执行记录

用户确认后，已备份并迁移主库、probe-strength 库和登记的三个 tmp 旧库。共删除 10 个身份证列，清洗主库 277 条 JSON 记录；五库迁移后敏感字段审计、完整性与外键检查通过，原有业务表行数保持一致。

两份 outputs 历史工作簿已备份并清洗，保留其他业务单元格；本地清洗副本保留并移出 Git 跟踪。两份检查 NDJSON 和两张相关截图已备份后删除。

29 份旧备份、3 份重建/演练快照及本次备份受控保留，文件权限 0600，备份目录 0700。详细清单保存在本地 `data/identity-removal-backups/2026-10-12/inventory.json`，不提交版本库。备份仍可能含原始身份证信息，保留期限与安全销毁方式待单独确认。本次未操作远端生产库或重写 Git 历史。

迁移后的主库一致性副本已成功启动服务，`/health` 返回 200；启动验证未直接写入主库。
