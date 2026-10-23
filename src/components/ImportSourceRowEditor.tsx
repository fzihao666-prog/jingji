import { useState } from 'react';
import { importTemplateFields, templateHeaderKey } from '../../shared/import-template-fields';
import type { DataImportItem } from '../types';

type SourceRow = { columns: [string, number][]; values: (string | number)[] };
function sourceRow(value: unknown): SourceRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as SourceRow;
  if (
    !Array.isArray(row.columns) ||
    !Array.isArray(row.values) ||
    !row.columns.every(
      (column) =>
        Array.isArray(column) &&
        typeof column[0] === 'string' &&
        Number.isSafeInteger(column[1]) &&
        column[1] >= 0
    )
  )
    return null;
  return row;
}

export function ImportSourceRowEditor({
  item,
  disabled,
  pending,
  metrics,
  onChange,
  onSave,
}: {
  item: DataImportItem;
  disabled: boolean;
  pending?: Record<string, string | number | null>;
  metrics: Array<{ code: string; label: string; unit: string }>;
  onChange: (cells: Record<string, string | number | null>) => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const row = sourceRow(item.payload.sourceRow);
  if (item.payload.sourceRowOutdated)
    return <p>此行已有单项校对，请继续使用上方字段修改；如需重修原行，请重新上传文件。</p>;
  if (!row)
    return item.itemType === 'invalid_row' ? (
      <p>此草稿缺少可编辑的源字段，请修正原文件后重新上传，或排除此行。</p>
    ) : null;
  const definitions = importTemplateFields(item.sourceSheet);
  return (
    <details
      className="import-source-editor"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>编辑原行字段</summary>
      <p>修改完成后点击保存并校验，该源行的全部记录会一起重新校验。</p>
      <div className="import-source-editor-fields">
        {row.columns.map(([header, index]) => {
          const key = templateHeaderKey(header);
          const field = definitions.find((definition) => definition.key === key);
          const value =
            pending && Object.hasOwn(pending, header)
              ? (pending[header] ?? '')
              : (row.values[index] ?? '');
          const metricNames = ['指标名称', '测试项目'].includes(key)
            ? metrics.map((metric) => `${metric.label}${metric.unit ? `（${metric.unit}）` : ''}`)
            : null;
          const choices = metricNames?.length ? metricNames : field?.choices;
          return (
            <label key={`${header}-${index}`}>
              <span>
                {field?.displayName || key}
                {field?.unit ? `（${field.unit}）` : ''}
              </span>
              {choices?.length ? (
                <select
                  disabled={disabled}
                  value={String(value)}
                  onChange={(event) => onChange({ [header]: event.target.value })}
                >
                  <option value="">未填写</option>
                  {value !== '' && !choices.includes(String(value)) && (
                    <option value={String(value)}>{String(value)}（原值，需修正）</option>
                  )}
                  {choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  disabled={disabled}
                  value={String(value)}
                  onChange={(event) => onChange({ [header]: event.target.value })}
                />
              )}
              {field?.fillCondition && <small>{field.fillCondition}</small>}
            </label>
          );
        })}
      </div>
      <button type="button" disabled={disabled || !pending || !Object.keys(pending).length} onClick={onSave}>保存并校验</button>
    </details>
  );
}
