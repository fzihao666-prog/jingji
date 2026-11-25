import {
  ACTIVITY_LABELS,
  isActivityCode,
  projectRules,
  allowedIntensitySystems,
  SPORT_RULES_VERSION,
} from '../../shared/sport-rules';
import { INTENSITY_ZONE_SYSTEMS } from '../../shared/training-intensity';
import { trainingContext } from '../../shared/training-context';
import { useEffect, useId, useRef, useState } from 'react';
import type { TeamPlanSession } from '../../shared/team-plan';
import './TrainingPlanSessionEditor.css';
type Props = {
  session: TeamPlanSession;
  project?: string;
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
  project,
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
          if (value.items?.some((item) => !item.title.trim())) {
            setError('请填写训练项目名称，或移除空项目。');
            return;
          }
          if (mode === 'override' && !adjustmentReason.trim()) {
            setError('请填写调整原因，不能只包含空格。');
            setErrorField('reason');
            reasonInput.current?.focus();
            return;
          }
          if (project) {
            try {
              trainingContext(project, {
                trainingType: { special: '专项训练', physical: '体能训练', recovery: '恢复训练' }[
                  value.category
                ],
                activityCode: value.activityCode,
                intensitySystem: value.intensitySystem,
                intensityZone: value.intensity,
                rulesVersion: value.rulesVersion,
              });
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '项目活动不适用');
              setErrorField(null);
              return;
            }
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
          <label htmlFor={field('activityCode')}>
            训练活动
            <select
              id={field('activityCode')}
              value={value.activityCode || 'unknown'}
              onChange={(event) => {
                if (isActivityCode(event.target.value))
                  setValue({
                    ...value,
                    activityCode: event.target.value,
                    intensitySystem: '',
                    intensity: '',
                    rulesVersion: SPORT_RULES_VERSION,
                  });
              }}
            >
              {(projectRules(project)?.activities || ['unknown']).map((activity) => (
                <option key={activity} value={activity}>
                  {ACTIVITY_LABELS[activity]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={field('intensitySystem')}>
            强度体系
            <select
              id={field('intensitySystem')}
              value={value.intensitySystem || ''}
              onChange={(event) =>
                setValue({
                  ...value,
                  intensitySystem: event.target.value,
                  intensity: '',
                  rulesVersion: SPORT_RULES_VERSION,
                })
              }
            >
              <option value="">未指定体系，仅记录原文</option>
              {INTENSITY_ZONE_SYSTEMS.filter((system) =>
                allowedIntensitySystems(project, value.activityCode).includes(system.code)
              ).map((system) => (
                <option key={system.code} value={system.code}>
                  {system.label}
                </option>
              ))}
            </select>
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
        <fieldset>
          <legend>训练项目（按执行顺序）</legend>
          {(value.items || []).map((item, index) => (
            <div key={item.id}>
              <label htmlFor={`${prefix}-item-title-${index}`}>项目 {index + 1}</label>
              <input
                id={`${prefix}-item-title-${index}`}
                value={item.title}
                maxLength={200}
                required
                onChange={(event) =>
                  setValue({
                    ...value,
                    items: value.items?.map((row, i) =>
                      i === index ? { ...row, title: event.target.value } : row
                    ),
                  })
                }
              />
              <label htmlFor={`${prefix}-item-description-${index}`}>训练内容与参数</label>
              <textarea
                id={`${prefix}-item-description-${index}`}
                value={item.description}
                maxLength={2000}
                onChange={(event) =>
                  setValue({
                    ...value,
                    items: value.items?.map((row, i) =>
                      i === index ? { ...row, description: event.target.value } : row
                    ),
                  })
                }
              />
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setValue({ ...value, items: value.items?.filter((_, i) => i !== index) })
                }
              >
                移除项目 {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary-button"
            disabled={(value.items?.length || 0) >= 50}
            onClick={() =>
              setValue({
                ...value,
                items: [
                  ...(value.items || []),
                  { id: crypto.randomUUID(), title: '', description: '' },
                ],
              })
            }
          >
            添加训练项目
          </button>
        </fieldset>
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
