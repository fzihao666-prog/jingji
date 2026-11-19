import { useRef, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { TrainingRecordTemplate } from '../../shared/training-record-template';

type Field = TrainingRecordTemplate['fields'][number];
export const blankTemplateField: Field = { name: '', unit: '', kind: 'number' };

export function TemplateProjectEditor({ name, fields, onName, onFields, fieldLimit, nameLimit, allowText = false, autoFocus, children }: {
  name: string;
  fields: Field[];
  onName: (name: string) => void;
  onFields: (fields: Field[]) => void;
  fieldLimit: number;
  nameLimit: number;
  allowText?: boolean;
  autoFocus?: boolean;
  children?: ReactNode;
}) {
  const addButton = useRef<HTMLButtonElement>(null);
  const fieldInputs = useRef<Array<HTMLInputElement | null>>([]);
  return (
    <div className="test-template-group-fields">
      <label className="data-import-template-team">项目名称
        <input required autoFocus={autoFocus} maxLength={nameLimit} value={name} onChange={event => onName(event.target.value)} />
      </label>
      {children}
      {fields.map((field, index) => {
        const change = (patch: Partial<Field>) => onFields(fields.map((entry, position) => position === index ? { ...entry, ...patch } : entry));
        return (
          <div key={index} className="test-template-actions">
            <label className="data-import-template-team">字段名称
              <input ref={input => { fieldInputs.current[index] = input; }} required maxLength={nameLimit}
                value={field.name} onChange={event => change({ name: event.target.value })} />
            </label>
            <label className="data-import-template-team">单位（选填）
              <input maxLength={24} value={field.unit} readOnly={field.kind === 'time'} onChange={event => change({ unit: event.target.value })} />
            </label>
            <label className="data-import-template-team">格式
              <select value={field.kind} onChange={event => {
                const value = event.target.value;
                const kind = value === 'time' || (allowText && value === 'text') ? value : 'number';
                change({ kind, unit: kind === 'time' ? 's' : field.kind === 'time' ? '' : field.unit });
              }}>
                <option value="number">数字</option>
                <option value="time">计时（秒或分:秒）</option>
                {allowText && <option value="text">文字</option>}
              </select>
            </label>
            <button type="button" className="secondary-button" aria-label={`移除第 ${index + 1} 个字段`} onClick={() => {
              onFields(fields.filter((_, position) => index !== position));
              addButton.current?.focus();
            }}>移除</button>
          </div>
        );
      })}
      <div><button ref={addButton} type="button" className="secondary-button" disabled={fields.length >= fieldLimit} onClick={() => {
        onFields([...fields, blankTemplateField]);
        requestAnimationFrame(() => fieldInputs.current[fields.length]?.focus());
      }}><Plus size={16} aria-hidden />添加字段</button></div>
    </div>
  );
}
