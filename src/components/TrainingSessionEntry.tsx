import type { TeamPlanSession } from '../../shared/team-plan';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import {
  allowedIntensitySystems,
  sessionQuantityHint,
  sessionQuantityRequirement,
  ACTIVITY_LABELS,
  isActivityCode,
  projectRules,
  type ActivityCode,
} from '../../shared/sport-rules';
import { INTENSITY_ZONE_SYSTEMS } from '../../shared/training-intensity';
import { AppCard } from './PageLayout';
import './TrainingSessionEntry.css';

type Props = {
  athleteId: number;
  project: string;
  mode: 'self' | 'coach';
  onSaved: () => void;
  plan?: { id: number; session: TeamPlanSession };
};

export function TrainingSessionEntry({ athleteId, project, mode, onSaved, plan }: Props) {
  const rules = projectRules(project);
  const [activity, setActivity] = useState<ActivityCode>(
    isActivityCode(plan?.session.activityCode) ? plan.session.activityCode : 'unknown'
  );
  const [intensitySystem, setIntensitySystem] = useState(plan?.session.intensitySystem || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const submission = useRef<{ key: string; content: string } | null>(null);
  const durationInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const quantityError = error.includes('时长');
  if (!rules) return null;
  const allowsDistance = sessionQuantityRequirement(project, activity) === 'duration|distance';
  const quantityHint = sessionQuantityHint(project, activity);
  const water = activity === 'on_water' || activity === 'ergometer';
  const power = water || activity === 'cycling';
  const date =
    plan?.session.date ||
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data: Record<string, string | number> = {};
    new FormData(form).forEach((value, key) => {
      if (typeof value === 'string') data[key] = value;
    });
    if (plan) {
      data.teamPlanId = plan.id;
      data.planSessionId = plan.session.id;
    }
    if (!(Number(data.duration) > 0) && (!allowsDistance || !(Number(data.distance) > 0))) {
      setError(quantityHint);
      durationInput.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const content = JSON.stringify(data);
      if (!submission.current || submission.current.content !== content)
        submission.current = { key: crypto.randomUUID(), content };
      await api.submitTrainingSession(mode, athleteId, data, submission.current.key);
      submission.current = null;
      form.reset();
      setActivity(
        isActivityCode(plan?.session.activityCode) ? plan.session.activityCode : 'unknown'
      );
      setIntensitySystem(plan?.session.intensitySystem || '');
      setMessage('训练记录已保存。');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }
  return (
    <AppCard className="training-session-entry">
      <h3>{plan ? '填写本课实际训练' : '填写训练记录'}</h3>
      {plan && <p>关联计划 #{plan.id}。只带入活动和任务；实际时长、距离与RPE仍须填写。</p>}
      <p>{quantityHint}RPE 可选；时长与 RPE 齐全才计算 SRPE。</p>
      <form onSubmit={submit}>
        <fieldset disabled={saving}>
          <legend>实际完成情况</legend>
          <input type="hidden" name="rulesVersion" value={rules.version} />
          <label>
            训练日期
            <input name="date" type="date" defaultValue={date} required />
          </label>
          <label>
            开始时间
            <input name="startTime" type="time" />
          </label>
          <label>
            训练类型
            <select
              name="trainingType"
              defaultValue={
                plan
                  ? { special: '专项训练', physical: '体能训练', recovery: '恢复训练' }[
                      plan.session.category
                    ]
                  : '专项训练'
              }
            >
              <option>专项训练</option>
              <option>体能训练</option>
              <option>恢复训练</option>
            </select>
          </label>
          <label>
            训练活动
            <select
              name="activityCode"
              value={activity}
              onChange={(event) => {
                if (isActivityCode(event.target.value)) setActivity(event.target.value);
                setIntensitySystem('');
              }}
            >
              {rules.activities.map((code) => (
                <option value={code} key={code}>
                  {ACTIVITY_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <label>
            时长（分钟）
            <input
              ref={durationInput}
              required={!allowsDistance}
              name="duration"
              type="number"
              min="1"
              max="1440"
              step="any"
              aria-invalid={quantityError || undefined}
              aria-describedby={quantityError ? errorId : undefined}
            />
          </label>
          <label>
            距离（公里，可选）
            <input
              name="distance"
              type="number"
              min="0"
              max="500"
              step="any"
              aria-invalid={quantityError || undefined}
              aria-describedby={quantityError ? errorId : undefined}
            />
          </label>
          <label>
            RPE（0—10，可选）
            <input name="rpe" type="number" min="0" max="10" step="any" />
          </label>
          <label>
            强度体系（可选）
            <select
              name="intensitySystem"
              value={intensitySystem}
              onChange={(event) => setIntensitySystem(event.target.value)}
            >
              <option value="">未指定</option>
              {INTENSITY_ZONE_SYSTEMS.filter((system) =>
                allowedIntensitySystems(project, activity).includes(system.code)
              ).map((system) => (
                <option key={system.code} value={system.code}>
                  {system.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            原始强度区（可选）
            <input name="intensityZone" maxLength={20} />
          </label>
          <label>
            平均心率（bpm，可选）
            <input name="averageHeartRate" type="number" min="0" max="250" />
          </label>
          <label>
            最大心率（bpm，可选）
            <input name="maxHeartRate" type="number" min="0" max="250" />
          </label>
          {power && (
            <label>
              平均功率（W，可选）
              <input name="averagePowerW" type="number" min="0" max="3000" step="any" />
            </label>
          )}
          {water && (
            <label>
              桨频/划频（次/分，可选）
              <input name="strokeRateSpm" type="number" min="0" max="100" step="any" />
            </label>
          )}
          {activity === 'cycling' && (
            <label>
              踏频（rpm，可选）
              <input name="cadenceRpm" type="number" min="0" max="300" step="any" />
            </label>
          )}
          <label className="training-session-content">
            训练内容
            <textarea
              name="content"
              required
              maxLength={500}
              defaultValue={plan?.session.content}
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" id={errorId}>
            {error}
          </p>
        )}
        <p role="status" aria-live="polite">
          {message}
        </p>
        <button type="submit" disabled={saving}>
          {saving ? '正在保存…' : '保存训练'}
        </button>
      </form>
    </AppCard>
  );
}
