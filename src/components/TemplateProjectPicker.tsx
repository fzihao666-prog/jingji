import type { Ref } from 'react';
import { Plus } from 'lucide-react';

export function TemplateProjectPicker({ groups, value, onChange, onAdd, onNew, newLabel, newButton, disabled }: {
  groups: Array<{ label: string; options: Array<{ value: string; label: string }> }>;
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  onNew: () => void;
  newLabel: string;
  newButton?: Ref<HTMLButtonElement>;
  disabled: boolean;
}) {
  return (
    <div className="test-template-actions template-project-picker">
      <label className="data-import-template-team">选择项目
        <select value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>
          <option value="">选择常用或已有项目</option>
          {groups.filter(group => group.options.length).map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <button type="button" className="secondary-button" disabled={disabled || !value} onClick={onAdd}>加入 Excel</button>
      <button ref={newButton} type="button" className="secondary-button" disabled={disabled} onClick={onNew}>
        <Plus size={16} aria-hidden />{newLabel}
      </button>
    </div>
  );
}
