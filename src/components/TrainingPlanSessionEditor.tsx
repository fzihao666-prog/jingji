import { useEffect, useId, useRef, useState } from 'react';
import type { TeamPlanSession } from '../../shared/team-plan';
import './TrainingPlanSessionEditor.css';
type Props = {
  session: TeamPlanSession;
  startDate: string;
  endDate: string;
  mode: 'session' | 'override';
  reason?: string;
  onSave: (session: TeamPlanSession, reason: string) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};
export function TrainingPlanSessionEditor({
  session,
  startDate,
  endDate,
  mode,
  reason = '',
  onSave,
  onCancel,
  onDirtyChange,
}: Props) {
  const [value, setValue] = useState(session);
  const [adjustmentReason, setAdjustmentReason] = useState(reason);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<'content' | 'reason' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const contentInput = useRef<HTMLTextAreaElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const prefix = useId();
  const dirty = JSON.stringify(value) !== JSON.stringify(session) || adjustmentReason !== reason;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const field = (key: keyof TeamPlanSession) => `${prefix}-${key}`;
  const numeric = (
    key: 'durationMin' | 'distanceKm' | 'sets' | 'reps' | 'load',
    label: string,
    max: number,
    integer = false
  ) => (
    <label htmlFor={field(key)}>
      {label}
      <input
        id={field(key)}
        type="number"
        min="0"
        max={max}
        step={integer ? 1 : 'any'}
        value={value[key] ?? ''}
        onChange={(event) =>
          setValue({
            ...value,
            [key]: event.target.value === '' ? null : Number(event.target.value),
          })
        }
      />
    </label>
  );
  return (
    <aside
      className="plan-session-editor"
      aria-labelledby={`${prefix}-title`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h3 ref={heading} tabIndex={-1} id={`${prefix}-title`}>
        {mode === 'override' ? '个人差异调整' : '编辑训练课'}
      </h3>
      <p className="muted">
        {mode === 'override'
          ? '未修改的字段继承队伍主计划；清空数值表示取消该项目标。'
          : '训练名称、目标、动作明细等沿用现有训练内容字段保存。'}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.content.trim()) {
            setError('请填写训练内容，不能只包含空格。');
            setErrorField('content');
            contentInput.current?.focus();
            return;
          }
          if (mode === 'override' && !adjustmentReason.trim()) {
            setError('请填写调整原因，不能只包含空格。');
            setErrorField('reason');
            reasonInput.current?.focus();
            return;
          }
          setError('');
          setErrorField(null);
          onSave({ ...value, content: value.content.trim() }, adjustmentReason.trim());
        }}
      >
        <div className="plan-session-editor-grid">
          <label htmlFor={field('date')}>
            训练日期
            <input
              id={field('date')}
              type="date"
              required
              min={startDate}
              max={endDate}
              value={value.date}
              disabled={mode === 'override'}
              onChange={(event) => setValue({ ...value, date: event.target.value })}
            />
          </label>
          <label htmlFor={field('category')}>
            训练类型
            <select
              id={field('category')}
              value={value.category}
              disabled={mode === 'override'}
              onChange={(event) =>
                setValue({ ...value, category: event.target.value as TeamPlanSession['category'] })
              }
            >
              <option value="special">专项</option>
              <option value="physical">体能</option>
              <option value="recovery">恢复</option>
            </select>
          </label>
          <label htmlFor={field('period')}>
            时段或时间
            <input
              id={field('period')}
              maxLength={80}
              value={value.period}
              placeholder="上午 / 下午 / 09:00"
              onChange={(event) => setValue({ ...value, period: event.target.value })}
            />
          </label>
          {numeric('durationMin', '计划时长（分钟）', 100000)}
          {value.category === 'special' && (
            <>
              {numeric('distanceKm', '计划距离（公里）', 100000)}
              <label htmlFor={field('intensity')}>
                目标强度
                <input
                  id={field('intensity')}
                  maxLength={200}
                  value={value.intensity}
                  placeholder="沿用项目现有强度"
                  onChange={(event) => setValue({ ...value, intensity: event.target.value })}
                />
              </label>
            </>
          )}
          {value.category === 'physical' && (
            <>
              {numeric('sets', '组数', 100000, true)}
              {numeric('reps', '每组次数', 100000, true)}
              {numeric('load', '负重或强度（沿用原单位）', 100000)}
            </>
          )}
        </div>
        <label htmlFor={field('content')}>训练名称、目标与内容</label>
        <textarea
          id={field('content')}
          ref={contentInput}
          aria-invalid={errorField === 'content' || undefined}
          aria-describedby={errorField === 'content' ? `${prefix}-error` : undefined}
          maxLength={4000}
          required
          value={value.content}
          onChange={(event) => {
            setValue({ ...value, content: event.target.value });
            if (errorField === 'content' && event.target.value.trim()) {
              setError('');
              setErrorField(null);
            }
          }}
          rows={6}
        />
        <p className="muted">
          水上/测功仪、桨频、每组距离、组间恢复及多个体能动作，可按行填写在训练内容中。
        </p>
        <label htmlFor={field('notes')}>技术要求及备注</label>
        <textarea
          id={field('notes')}
          maxLength={4000}
          value={value.notes}
          rows={3}
          onChange={(event) => setValue({ ...value, notes: event.target.value })}
        />
        {mode === 'override' && (
          <>
            <label htmlFor={`${prefix}-reason`}>调整原因</label>
            <textarea
              id={`${prefix}-reason`}
              ref={reasonInput}
              aria-invalid={errorField === 'reason' || undefined}
              aria-describedby={errorField === 'reason' ? `${prefix}-error` : undefined}
              maxLength={1000}
              required
              value={adjustmentReason}
              rows={2}
              onChange={(event) => {
                setAdjustmentReason(event.target.value);
                if (errorField === 'reason' && event.target.value.trim()) {
                  setError('');
                  setErrorField(null);
                }
              }}
            />
          </>
        )}
        <p id={`${prefix}-error`} role="alert">
          {error}
        </p>
        <div className="plan-session-editor-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="primary-button">
            {mode === 'override' ? '保存调整' : '保存训练课'}
          </button>
        </div>
      </form>
    </aside>
  );
}
