import { useEffect, useState } from 'react';
import {
  reviewFields,
  reviewValues,
  databaseReviewRecords,
  requiresDatabaseReview,
  reviewTitle,
  importFieldValues,
  type ReviewValue,
} from '../../shared/import-conflict-review';
import type { DataImportItem } from '../types';

type Props = {
  items: DataImportItem[];
  disabled: boolean;
  onMerge: (
    targetId: number,
    memberIds: number[],
    values: Record<string, ReviewValue>,
    includeDatabase?: boolean
  ) => void;
  onReopen: (targetId: number) => void;
  onExclude: (itemId: number) => void;
  onDraft: (
    targetId: number,
    choices: Record<string, string>,
    manual: Record<string, string>
  ) => void;
  onSplit: (dates: Array<{ id: number; eventDate: string }>) => void;
};

/** 同人同日的原始测量并排比较；选择仅为草稿，确认后由服务端合并。 */
export function ImportConflictReview({
  items,
  disabled,
  onMerge,
  onReopen,
  onSplit,
  onExclude,
  onDraft,
}: Props) {
  const target = items.find((item) => item.payload.valueReviewDecision) || items[0];
  const decision = target.payload.valueReviewDecision as
    | {
        sources: Array<{ id: number; values: Record<string, unknown> }>;
        databaseSources?: Array<{ id: number; values: Record<string, unknown> }>;
        finalValues: Record<string, ReviewValue>;
      }
    | undefined;
  const fileOriginals = items.map((item) => ({
    ...item,
    payload: decision?.sources.find((source) => source.id === item.id)?.values || {
      ...item.payload,
      ...reviewValues(item, items),
    },
  }));
  const database: DataImportItem[] =
    decision?.databaseSources?.map((source) => {
      const base = items.find((item) => item.id === source.id) || target;
      return {
        ...base,
        id: -source.id,
        payload: { ...source.values, reviewDatabase: true },
        sourceSheet: '数据库已有',
        sourceAddress: '',
        rawValue: JSON.stringify(source.values),
      };
    }) || (items.some(requiresDatabaseReview) ? databaseReviewRecords(items) : []);
  const originals: DataImportItem[] = [...fileOriginals, ...database];
  const draft = target.payload.valueReviewDraft as
    { choices: Record<string, string>; manual: Record<string, string> } | undefined;
  const [choices, setChoices] = useState<Record<string, string>>(draft?.choices || {});
  const [manual, setManual] = useState<Record<string, string>>(draft?.manual || {});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty || disabled) return;
    const timer = window.setTimeout(() => {
      setDirty(false);
      onDraft(target.id, choices, manual);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [choices, manual, dirty, disabled, onDraft, target.id]);
  const updateChoice = (field: string, value: string) => {
    setChoices((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };
  const updateManual = (field: string, value: string) => {
    setManual((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };
  const [split, setSplit] = useState(false);
  const [dates, setDates] = useState<Record<number, string>>({});
  const validationMessages = [
    ...new Set(
      items
        .filter((item) => item.resolution !== 'skip')
        .flatMap((item) =>
          item.messages.filter(
            (message) =>
              !message.includes('集中审查卡片') &&
              !(
                Array.isArray(item.payload.valueImportConflicts) &&
                item.payload.valueImportConflicts.includes(message)
              )
          )
        )
    ),
  ];
  const fields = reviewFields(originals).filter(
    ([, field]) => importFieldValues(originals, field).length > 0
  );
  const visibleFields = fields.filter(
    ([, field]) =>
      importFieldValues(originals, field).length > 1 ||
      originals.every((item) => item.payload[field] != null) ||
      validationMessages.length > 0 ||
      choices[field] != null
  );
  const finalValues: Record<string, ReviewValue> = {};
  let remaining = 0;
  for (const [, field, , , , kind] of fields) {
    const values = importFieldValues(originals, field);
    const choice = choices[field] ?? (values.length === 1 ? String(values[0]) : '');
    const raw = choice === 'manual' ? (manual[field] ?? '') : choice;
    if (raw.trim() === '' || (kind !== 'text' && !Number.isFinite(Number(raw)))) remaining++;
    else finalValues[field] = kind === 'text' ? raw : Number(raw);
  }
  const finalDates = items.map((item) => ({
    id: item.id,
    eventDate: dates[item.id] ?? item.eventDate,
  }));
  const validSplit =
    finalDates.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.eventDate)) &&
    new Set(finalDates.map((item) => item.eventDate)).size === items.length &&
    (!database.length || finalDates.some((item) => item.eventDate !== target.eventDate));
  return (
    <section
      className="import-value-review-card"
      aria-label={`${target.rawAthleteName} ${target.eventDate} ${reviewTitle(target)}审查`}
    >
      <header>
        <div>
          <h3>
            {target.athleteName || target.rawAthleteName || '数据规则'} · {reviewTitle(target)}
            {target.eventDate ? ` · ${target.eventDate}` : ''}
          </h3>
          <p>
            {target.athleteTeam || '队伍待确认'} · {items.length} 条导入记录
            {database.length > 0 ? ' · 数据库已有值参与比较' : ''} ·{' '}
            {decision
              ? target.quality === 'error'
                ? '合并结果校验未通过，请重新编辑'
                : '已合并（提交前可重新编辑）'
              : remaining
                ? `${remaining} 个字段待选择`
                : fields.some(([, field]) => importFieldValues(originals, field).length > 1)
                  ? '最终值已选齐，待确认'
                  : '相同及互补字段已自动整理，待确认'}
          </p>
          {target.eventDate && items.some((item) => !item.payload.rawDate) && (
            <p className="import-value-review-notice">
              原表未填日期，已使用默认日期。请先核对是否为同一次记录。
            </p>
          )}
        </div>
        {decision ? (
          <button type="button" disabled={disabled} onClick={() => onReopen(target.id)}>
            重新编辑
          </button>
        ) : (
          <div className="import-value-review-actions">
            <button
              type="button"
              aria-pressed={!split}
              disabled={disabled}
              onClick={() => setSplit(false)}
            >
              同一记录，选择最终值
            </button>
            <button
              type="button"
              aria-pressed={split}
              disabled={disabled || !target.eventDate}
              onClick={() => setSplit(true)}
            >
              不同次记录，分别保留
            </button>
          </div>
        )}
      </header>
      {validationMessages.length > 0 && (
        <div className="import-value-review-validation" role="alert">
          {validationMessages.map((message) => (
            <p key={message}>{message.replace(/^错误：/, '')}</p>
          ))}
        </div>
      )}
      {split && !decision ? (
        <div className="import-value-review-split">
          <p>
            请填写各次记录的真实日期。同一业务唯一键下的多次记录当前不能分别入库，请保留草稿待处理，不要为消除冲突随意改日期。
          </p>
          {items.map((item, index) => (
            <label key={item.id}>
              <span>记录 {index + 1} 的真实日期</span>
              <input
                type="date"
                disabled={disabled}
                value={dates[item.id] ?? item.eventDate}
                onChange={(event) =>
                  setDates((current) => ({ ...current, [item.id]: event.target.value }))
                }
              />
            </label>
          ))}
          <button
            type="button"
            disabled={disabled || !validSplit}
            onClick={() => onSplit(finalDates)}
          >
            保存日期并重新分组
          </button>
        </div>
      ) : (
        <>
          <div className="import-value-review-comparison-wrap" hidden={visibleFields.length === 0}>
            <table className="import-value-review-comparison">
              <caption>原始记录对比与最终入库值</caption>
              <thead>
                <tr>
                  <th scope="col">指标</th>
                  {originals.map((item, index) => (
                    <th scope="col" key={item.id}>
                      {item.payload.reviewDatabase ? '数据库已有' : `记录 ${index + 1}`}
                    </th>
                  ))}
                  <th scope="col">最终入库值</th>
                </tr>
              </thead>
              <tbody>
                {visibleFields.map(([header, field, , , unit, kind]) => {
                  const values = importFieldValues(originals, field);
                  const choice = choices[field] ?? (values.length === 1 ? String(values[0]) : '');
                  return (
                    <tr key={field}>
                      <th scope="row">
                        {header}
                        {field === 'protocol' && database.length > 0 && (
                          <small>协议属于整次测试，确认后会应用于该课次全部指标。</small>
                        )}
                      </th>
                      {originals.map((item) => (
                        <td key={item.id}>
                          {item.payload[field] == null ? '未提供' : String(item.payload[field])}
                        </td>
                      ))}
                      <td>
                        {decision ? (
                          <strong>
                            {decision.finalValues[field] ?? '未测量'} {unit}
                          </strong>
                        ) : values.length === 1 ? (
                          <>
                            <input
                              aria-label={`${header}最终值`}
                              disabled={disabled}
                              type={kind === 'text' ? 'text' : 'number'}
                              step="any"
                              value={choices[field] ?? String(values[0])}
                              onChange={(event) => updateChoice(field, event.target.value)}
                            />
                            <small>
                              {originals.every((item) => item.payload[field] != null)
                                ? '相同，自动合并（可修改）'
                                : '单方有值，自动补齐（可修改）'}
                            </small>
                          </>
                        ) : (
                          <>
                            <select
                              aria-label={`${header}最终值`}
                              disabled={disabled}
                              value={choice}
                              onChange={(event) => updateChoice(field, event.target.value)}
                            >
                              <option value="">待选择</option>
                              {values.map((value) => (
                                <option key={value} value={String(value)}>
                                  {value} {unit}（记录{' '}
                                  {originals
                                    .map((item, index) =>
                                      item.payload[field] === value
                                        ? item.payload.reviewDatabase
                                          ? '数据库已有'
                                          : index + 1
                                        : null
                                    )
                                    .filter(Boolean)
                                    .join('、')}
                                  ）
                                </option>
                              ))}
                              <option value="manual">手动输入</option>
                            </select>
                            {choice === 'manual' && (
                              <input
                                aria-label={`手动填写${header}`}
                                disabled={disabled}
                                type={kind === 'text' ? 'text' : 'number'}
                                step="any"
                                value={manual[field] ?? ''}
                                onChange={(event) => updateManual(field, event.target.value)}
                              />
                            )}
                            <small>
                              {finalValues[field] == null
                                ? '最终值：待选择'
                                : `最终值：${finalValues[field]} ${unit}`}
                            </small>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!decision && (
            <button
              type="button"
              disabled={disabled || remaining > 0}
              onClick={() =>
                onMerge(
                  target.id,
                  items.map((item) => item.id),
                  finalValues,
                  database.length > 0
                )
              }
            >
              确认最终值{remaining > 0 ? `（${remaining} 个字段待选择）` : ''}
            </button>
          )}
        </>
      )}
      {target.conflict?.exists && (
        <details className="import-source-details">
          <summary>数据库原值与最终结果</summary>
          {decision && <p>已按逐字段选择确定最终值；需要调整时请点击“重新编辑”。</p>}
          {target.conflict.fields.map((field) => (
            <p key={field.field}>
              {field.label}：数据库 {field.oldValue || '空'} → 导入 {field.newValue}
              {field.overwrites ? (decision ? '（已确认最终值）' : '（待选择）') : ''}
            </p>
          ))}
        </details>
      )}
      <details className="import-source-details">
        <summary>查看原始记录</summary>
        {originals.map((item, index) => (
          <div key={item.id}>
            <strong>
              记录 {index + 1} · {item.sourceSheet} · {item.sourceAddress}
            </strong>
            <p>
              原始日期：
              {item.payload.reviewDatabase
                ? '数据库已有记录'
                : items[index]?.payload.rawDate
                  ? String(items[index].payload.rawDate)
                  : '未填，已使用默认日期'}
            </p>
            <p>原值：{item.rawValue}</p>
            {!decision && !item.payload.reviewDatabase && (
              <button type="button" disabled={disabled} onClick={() => onExclude(item.id)}>
                排除记录 {index + 1}（整条不导入）
              </button>
            )}
          </div>
        ))}
      </details>
    </section>
  );
}
