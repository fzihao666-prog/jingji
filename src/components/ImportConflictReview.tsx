import { useEffect, useState } from 'react';
import {
  reviewFields,
  importSessionChoices,
  reviewValues,
  databaseReviewRecords,
  requiresDatabaseReview,
  reviewTitle,
  importFieldValues,
  reviewComparisonRecords,
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
  onExclude: (itemId: number) => void;
  onDraft: (
    targetId: number,
    choices: Record<string, string>,
    manual: Record<string, string>
  ) => void;
  onAssignSession?: (itemId: number, sessionOrder: number) => void;
  onPending?: (targetId: number) => void;
  onSplit: (dates: Array<{ id: number; eventDate: string }>) => void;
};

/** 点击原始值即可选择；选齐后自动保存合并结果，正式写入仍由提交事务完成。 */
export function ImportConflictReview({
  items,
  disabled,
  onMerge,
  onSplit,
  onExclude,
  onDraft,
  onPending,
  onAssignSession,
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
  const [choices, setChoices] = useState<Record<string, string>>(draft?.choices || Object.fromEntries(Object.entries(decision?.finalValues || {}).map(([field, value]) => [field, String(value)])));
  const [manual] = useState<Record<string, string>>(draft?.manual || {});
  const [dirty, setDirty] = useState(false);
  const updateChoice = (field: string, value: string) => {
    setChoices((current) => ({ ...current, [field]: value }));
    setDirty(true);
    onPending?.(target.id);
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
      validationMessages.length > 0
  );
  const comparisonRecords = reviewComparisonRecords(originals, visibleFields.map(([, field]) => field));
  const finalValues: Record<string, ReviewValue> = {};
  let remaining = 0;
  for (const [, field, , , , kind] of fields) {
    const values = importFieldValues(originals, field);
    const choice = choices[field] ?? (values.length === 1 ? String(values[0]) : '');
    const raw = choice === 'manual' ? (manual[field] ?? '') : choice;
    if (raw.trim() === '' || (kind !== 'text' && !Number.isFinite(Number(raw)))) remaining++;
    else finalValues[field] = kind === 'text' ? raw : Number(raw);
  }
  const serializedValues = JSON.stringify(finalValues);
  useEffect(() => {
    if (!dirty || disabled || split || items.some(item => importSessionChoices(item).length > 1)) return;
    const timer = window.setTimeout(() => {
      setDirty(false);
      if (remaining === 0) onMerge(target.id, items.map(item => item.id), JSON.parse(serializedValues) as Record<string, ReviewValue>, database.length > 0);
      else onDraft(target.id, choices, manual);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [dirty, disabled, split, remaining, target.id, items, serializedValues, database.length, choices, manual, onMerge, onDraft]);
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
            <span role="status">{items.some(item => importSessionChoices(item).length > 1) ? '请先选择所属课次' : dirty || disabled ? '正在保存选择…' : remaining ? `${remaining} 个字段待选择` : '已选齐，自动保存'}</span>
          </p>
          {target.eventDate && items.some((item) => !item.payload.rawDate) && (
            <p className="import-value-review-notice">
              原表未填日期，已使用默认日期。请先核对是否为同一次记录。
            </p>
          )}
        </div>
        {!decision && <div className="import-value-review-actions">
          <button type="button" aria-pressed={split} disabled={disabled || !target.eventDate} onClick={() => setSplit(current => !current)}>
            {split ? '返回选择记录' : '不同次记录，分别保留'}
          </button>
        </div>}
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
          <div className="import-value-review-comparison-wrap" hidden={visibleFields.length === 0 && !items.some(item => importSessionChoices(item).length > 1)}>
            <table className="import-value-review-comparison">
              <caption>{items.some(item => importSessionChoices(item).length > 1) ? '请先选择每条记录所属课次' : '点击要采用的记录值，选中后自动保存'}</caption>
              <thead>
                <tr>
                  <th scope="col">指标</th>
                  {comparisonRecords.map(({ item, index }) => (
                    <th scope="col" key={item.id}>
                      {item.payload.reviewDatabase ? '数据库已有' : `记录 ${index + 1}`}
                      {!item.payload.reviewDatabase && importSessionChoices(item).length > 1 && <label>
                        <span>所属课次</span>
                        <select aria-label={`记录 ${index + 1} 所属课次`} disabled={disabled}
                          value={Number(item.payload.sessionOrder) || ''}
                          onChange={event => onAssignSession?.(item.id, Number(event.target.value))}>
                          <option value="">请选择课次</option>
                          {importSessionChoices(item).map(choice => <option key={choice.sessionOrder} value={choice.sessionOrder}>第 {choice.sessionOrder} 课 · {choice.label}</option>)}
                        </select>
                      </label>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleFields.map(([header, field, , , unit]) => {
                  const values = importFieldValues(originals, field);
                  const choice = choices[field] ?? (values.length === 1 ? String(values[0]) : '');
                  return (
                    <tr key={field}>
                      <th scope="row">
                        {header}
                        {field === 'protocol' && database.length > 0 && (
                          <small>协议属于整次测试，所选协议会应用于该课次全部指标。</small>
                        )}
                      </th>
                      {comparisonRecords.map(({ item, index }) => {
                        const value = item.payload[field];
                        const selected = value != null && choice === String(value);
                        return <td key={item.id}>
                          {value == null ? '未提供' : <button
                            type="button" className="import-value-review-choice"
                            aria-label={`${header}：${value}${unit}（${item.payload.reviewDatabase ? '数据库已有' : `记录 ${index + 1}`}）`}
                            aria-pressed={selected} disabled={disabled || items.some(source => importSessionChoices(source).length > 1)}
                            onClick={() => updateChoice(field, String(value))}
                          >{String(value)} {unit}{selected && <span> ✓ 已选</span>}</button>}
                        </td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        </>
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
