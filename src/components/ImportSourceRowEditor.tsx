import { useId, useState } from 'react';
import { Save } from 'lucide-react';
import { importTemplateFields, templateHeaderKey } from '../../shared/import-template-fields';
import type { DataImportItem } from '../types';

const RECORD_DATE_HEADERS = new Set(['日期', '身体测量日期', '测量日期', '测试日期', '发生日期', '评估日期', '训练日期']);

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
  describedBy,
  metrics,
  onChange,
  onSave,
}: {
  item: Pick<DataImportItem, 'itemType' | 'sourceSheet' | 'payload' | 'messages'>;
  disabled: boolean;
  describedBy?: string;
  pending?: Record<string, string | number | null>;
  metrics: Array<{ code: string; label: string; unit: string }>;
  onChange: (cells: Record<string, string | number | null>) => void;
  onSave: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const fieldsId = useId();
  const row = sourceRow(item.payload.sourceRow);
  if (item.payload.sourceRowOutdated || !row)
    return item.itemType === 'invalid_row' ? (
      <p>此行无法在页面上修改。请在 Excel 修正后重新上传，或排除此行。</p>
    ) : null;

  const definitions = importTemplateFields(item.sourceSheet);
  const errors = item.messages.filter(message => message.startsWith('错误：'));
  const locations = new Set(errors.flatMap(message => {
    const prefix = `错误：${item.sourceSheet}!`;
    if (!message.startsWith(prefix)) return [];
    const cell = /^([A-Z]+)\d+\s/.exec(message.slice(prefix.length));
    return cell ? [cell[1]] : [];
  }));
  const unlocatedReasons = errors.filter(message => !message.startsWith(`错误：${item.sourceSheet}!`))
    .map(message => message.slice('错误：'.length));
  const problemColumns = row.columns.filter(([header, index]) => {
    let letters = '';
    for (let column = index + 1; column > 0; column = Math.floor((column - 1) / 26)) {
      letters = String.fromCharCode(65 + (column - 1) % 26) + letters;
    }
    const key = templateHeaderKey(header);
    return locations.has(letters) || unlocatedReasons.some(reason =>
      (key.length > 1 && reason.startsWith(key)) ||
      (RECORD_DATE_HEADERS.has(key) && reason.startsWith('缺少有效') && reason.includes('日期'))
    );
  });
  const visibleColumns = showAll ? row.columns : problemColumns;
  return (
    <div className="import-source-editor">
      {visibleColumns.length > 0 && (
        <div id={fieldsId} className="import-source-editor-fields">
          {visibleColumns.map(([header, index]) => {
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
            const invalid = problemColumns.some(([, column]) => column === index);
            return (
              <label key={`${header}-${index}`}>
                <span>
                  {field?.displayName || key}
                  {field?.unit ? `（${field.unit}）` : ''}
                </span>
                {choices?.length ? (
                  <select
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? describedBy : undefined}
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
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? describedBy : undefined}
                    disabled={disabled}
                    value={String(value)}
                    onChange={(event) => onChange({ [header]: event.target.value })}
                  />
                )}
                {showAll && field?.fillCondition && <small>{field.fillCondition}</small>}
              </label>
            );
          })}
        </div>
      )}
      <div className="import-source-editor-actions">
        {visibleColumns.length > 0 && <button
          type="button"
          className="primary-button"
          disabled={disabled || !pending || !Object.keys(pending).length}
          onClick={onSave}
        >
          <Save size={16} aria-hidden="true" />
          保存并校验
        </button>}
        {row.columns.length > problemColumns.length && <button
          type="button"
          className="secondary-button"
          aria-expanded={showAll}
          aria-controls={visibleColumns.length ? fieldsId : undefined}
          disabled={disabled}
          onClick={() => setShowAll(current => !current)}
        >
          {showAll ? '收起其他字段' : problemColumns.length ? '修改其他字段' : '修改本行'}
        </button>}
      </div>
    </div>
  );
}
