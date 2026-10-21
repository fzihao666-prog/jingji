import { useEffect, useState } from 'react';
import { BODY_REVIEW_FIELDS, bodyFieldValues } from '../../shared/body-import-review';
import type { DataImportItem } from '../types';

type Props = {
  items: DataImportItem[];
  disabled: boolean;
  onMerge: (targetId: number, memberIds: number[], values: Record<string, number>) => void;
  onReopen: (targetId: number) => void;
  onExclude: (itemId: number) => void;
  onDraft: (
    targetId: number,
    choices: Record<string, string>,
    manual: Record<string, string>
  ) => void;
  onPolicy: (targetId: number, policy: '' | 'skip' | 'update') => void;
  onSplit: (dates: Array<{ id: number; eventDate: string }>) => void;
};

/** 同人同日的原始测量并排比较；选择仅为草稿，确认后由服务端合并。 */
export function BodyMeasurementReview({
  items,
  disabled,
  onMerge,
  onReopen,
  onSplit,
  onPolicy,
  onExclude,
  onDraft,
}: Props) {
  const target = items.find((item) => item.payload.bodyMergeDecision) || items[0];
  const decision = target.payload.bodyMergeDecision as
    | {
        sources: Array<{ id: number; values: Record<string, unknown> }>;
        finalValues: Record<string, number>;
      }
    | undefined;
  const originals = items.map((item) => ({
    ...item,
    payload: decision?.sources.find((source) => source.id === item.id)?.values || item.payload,
  }));
  const draft = target.payload.bodyMergeDraft as
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
                Array.isArray(item.payload.bodyImportConflicts) &&
                item.payload.bodyImportConflicts.includes(message)
              )
          )
        )
    ),
  ];
  const fields = BODY_REVIEW_FIELDS.filter(
    ([, field]) => bodyFieldValues(originals, field).length > 0
  );
  const finalValues: Record<string, number> = {};
  let remaining = 0;
  for (const [, field] of fields) {
    const values = bodyFieldValues(originals, field);
    const choice = choices[field] ?? (values.length === 1 ? String(values[0]) : '');
    const raw = choice === 'manual' ? (manual[field] ?? '') : choice;
    if (raw.trim() === '' || !Number.isFinite(Number(raw))) remaining++;
    else finalValues[field] = Number(raw);
  }
  const finalDates = items.map((item) => ({
    id: item.id,
    eventDate: dates[item.id] ?? item.eventDate,
  }));
  const validSplit =
    finalDates.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.eventDate)) &&
    new Set(finalDates.map((item) => item.eventDate)).size === items.length;
  return (
    <section
      className="body-review-card"
      aria-label={`${target.rawAthleteName} ${target.eventDate} 身体测量审查`}
    >
      <header>
        <div>
          <h3>
            {target.athleteName || target.rawAthleteName} · {target.eventDate}
          </h3>
          <p>
            {target.athleteTeam || '队伍待确认'} · {items.length} 条测量记录 ·{' '}
            {decision
              ? target.quality === 'error'
                ? '合并结果校验未通过，请重新编辑'
                : '已合并（提交前可重新编辑）'
              : remaining
                ? `${remaining} 个字段待选择`
                : '相同及互补字段已自动整理，待确认'}
          </p>
          {items.some((item) => !item.payload.rawDate) && (
            <p className="body-review-notice">
              原表未填日期，已使用默认日期。请先核对是否为同一次测量。
            </p>
          )}
        </div>
        {decision ? (
          <button type="button" disabled={disabled} onClick={() => onReopen(target.id)}>
            重新编辑
          </button>
        ) : (
          <div className="body-review-actions">
            <button
              type="button"
              aria-pressed={!split}
              disabled={disabled}
              onClick={() => setSplit(false)}
            >
              同一次测量，合并
            </button>
            <button
              type="button"
              aria-pressed={split}
              disabled={disabled}
              onClick={() => setSplit(true)}
            >
              不同次测量，分别保留
            </button>
          </div>
        )}
      </header>
      {validationMessages.length > 0 && (
        <div className="body-review-validation" role="alert">
          {validationMessages.map((message) => (
            <p key={message}>{message.replace(/^错误：/, '')}</p>
          ))}
        </div>
      )}
      {split && !decision ? (
        <div className="body-review-split">
          <p>
            请填写各次测量的真实日期。同一天多次测量当前不能分别入库，请保留草稿待处理，不要为消除冲突随意改日期。
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
          <div className="body-review-comparison-wrap">
            <table className="body-review-comparison">
              <caption>原始测量对比与最终入库值</caption>
              <thead>
                <tr>
                  <th scope="col">指标</th>
                  {items.map((item, index) => (
                    <th scope="col" key={item.id}>
                      记录 {index + 1}
                    </th>
                  ))}
                  <th scope="col">最终入库值</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(([header, field, , , unit]) => {
                  const values = bodyFieldValues(originals, field);
                  const choice = choices[field] ?? (values.length === 1 ? String(values[0]) : '');
                  return (
                    <tr key={field}>
                      <th scope="row">{header}</th>
                      {originals.map((item) => (
                        <td key={item.id}>
                          {item.payload[field] == null ? '未测量' : String(item.payload[field])}
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
                              type="number"
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
                                      item.payload[field] === value ? index + 1 : null
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
                                type="number"
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
                  finalValues
                )
              }
            >
              确认合并{remaining > 0 ? `（${remaining} 个字段待选择）` : ''}
            </button>
          )}
        </>
      )}
      {target.conflict?.exists && (
        <details className="import-source-details">
          <summary>与数据库已有数据比较（表内合并不会自动覆盖）</summary>
          {decision && (
            <label>
              数据库重复处理
              <select
                aria-label="合并后数据库重复处理"
                disabled={disabled}
                value={target.resolution}
                onChange={(event) =>
                  onPolicy(target.id, event.target.value as '' | 'skip' | 'update')
                }
              >
                <option value="">按批次策略</option>
                <option value="skip">跳过合并结果</option>
                <option value="update">更新数据库已有值</option>
              </select>
            </label>
          )}
          {target.conflict.fields.map((field) => (
            <p key={field.field}>
              {field.label}：数据库 {field.oldValue || '空'} → 导入 {field.newValue}
              {field.overwrites ? '（仍需按重复处理策略确认覆盖）' : ''}
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
              {items[index].payload.rawDate
                ? String(items[index].payload.rawDate)
                : '未填，已使用默认日期'}
            </p>
            <p>原值：{item.rawValue}</p>
            {!decision && (
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
