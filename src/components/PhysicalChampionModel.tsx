import { useEffect, useId, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Athlete, Project } from '../types';
import { projectLabel } from '../../shared/projects';
import {
  physicalReferenceDraftSchema,
  type PhysicalChampionPayload,
  type PhysicalReference,
} from '../../shared/physical-champion';
import { PhysicalChampionOverview } from './PhysicalChampionOverview';
import { ChartCard, ContentState } from './PageLayout';
import './PhysicalChampionModel.css';

type Props = {
  project: Project;
  from: string;
  to: string;
  athletes: Athlete[];
  athleteId: number | null;
};
const sourceNatureLabel = {
  official_research: '研究或官方资料',
  expert: '专家经验',
  team: '队内统计',
  estimated: '估算',
  unverified: '待核实',
} as const;
const reviewStatusLabel = { draft: '草稿', reviewed: '已生效', disabled: '停用' } as const;

function ReferenceEditor({
  reference,
  project,
  onSaved,
}: {
  reference?: PhysicalReference;
  project: string;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const id = useId();
  async function review(status: 'reviewed' | 'disabled') {
    if (!reference || saving) return;
    setSaving(true);
    try {
      setMessage(
        (
          await api.reviewPhysicalReference(reference.id, {
            expectedRevision: reference.revision,
            status,
          })
        ).message
      );
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '停用失败。');
    } finally {
      setSaving(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || '').trim();
    const draft = {
      project,
      key: value('key'),
      referenceLabel: value('referenceLabel'),
      value: Number(value('value')),
      unit: value('unit'),
      protocol: value('protocol'),
      protocolVersion: value('protocolVersion'),
      testContext: value('testContext'),
      side: value('side'),
      direction: value('direction'),
      sourceType: value('sourceType'),
      sourceNature: value('sourceNature'),
      sourceNote: value('sourceNote'),
      gender: value('gender'),
      event: value('event'),
      weightClass: 'open',
      ageGroup: value('ageGroup'),
      position: value('position'),
      referenceLevel: value('referenceLevel'),
      effectiveFrom: value('effectiveFrom'),
      effectiveTo: value('effectiveTo') || null,
      dimensionVersion: value('dimensionVersion'),
      measurementCodes: value('measurementCodes')
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean),
      measurementUnit: value('measurementUnit'),
      weightRelative: form.has('weightRelative'),
    };
    // 与服务端共用配置契约，来源和日期在两端验证。
    const parsed = physicalReferenceDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setMessage('请补全适用范围、维度、来源及有效日期。');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const result = reference
        ? await api.updatePhysicalReference(reference.id, {
            expectedRevision: reference.revision,
            draft: parsed.data,
          })
        : await api.createPhysicalReference(parsed.data);
      setMessage(result.message);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  }
  const fields = [
    ['key', '指标标识', reference?.key || ''],
    ['referenceLabel', '参考名称', reference?.referenceLabel || ''],
    ['value', '参考值', String(reference?.value || '')],
    ['unit', '比较单位', reference?.unit || ''],
    ['protocol', '完整测试协议', reference?.protocol || ''],
    ['protocolVersion', '协议版本（空仅匹配默认版本）', reference?.protocolVersion || ''],
    ['testContext', '测试条件（空仅匹配默认条件）', reference?.testContext || ''],
    ['sourceNote', '来源材料与说明', reference?.sourceNote || ''],
    ['event', '分项（开放填open）', reference?.event || 'open'],
    ['position', '位置（开放填open）', reference?.position || 'open'],
    ['referenceLevel', '级别（开放填open）', reference?.referenceLevel || 'open'],
    [
      'dimensionVersion',
      '维度版本',
      reference?.dimensionVersion === 'legacy-unreviewed' ? '' : reference?.dimensionVersion || '',
    ],
    ['measurementCodes', '测量指标代码（逗号分隔）', reference?.measurementCodes.join(',') || ''],
    ['measurementUnit', '实测单位', reference?.measurementUnit || ''],
    ['effectiveFrom', '生效日期', reference?.effectiveFrom || ''],
    ['effectiveTo', '结束日期（可空）', reference?.effectiveTo || ''],
  ];
  const selects = [
    [
      'side',
      '测量侧别',
      reference?.side || 'center',
      [
        ['center', '中心'],
        ['bilateral', '双侧'],
        ['left', '左侧'],
        ['right', '右侧'],
      ],
    ],
    [
      'direction',
      '比较方向',
      reference?.direction || 'higher_better',
      [
        ['higher_better', '越大越好'],
        ['lower_better', '越小越好'],
      ],
    ],
    [
      'sourceType',
      '原始来源类型',
      reference?.sourceType || 'public_reference',
      [
        ['public_reference', '公开参考'],
        ['measured', '实测资料'],
        ['estimated', '估算'],
      ],
    ],
    [
      'sourceNature',
      '来源性质',
      reference?.sourceNature === 'unverified' ? '' : reference?.sourceNature || '',
      [
        ['', '请选择'],
        ['official_research', '研究或官方资料'],
        ['expert', '专家经验'],
        ['team', '队内统计'],
        ['estimated', '估算'],
      ],
    ],
    [
      'gender',
      '性别',
      reference?.gender || 'open',
      [
        ['open', '开放'],
        ['男', '男'],
        ['女', '女'],
      ],
    ],
    [
      'ageGroup',
      '年龄组',
      reference?.ageGroup || 'adult',
      [
        ['adult', '成人（需生日）'],
        ['open', '开放'],
      ],
    ],
  ] as const;
  return (
    <details>
      <summary>
        {reference
          ? `版本 ${reference.version} · ${reviewStatusLabel[reference.reviewStatus]} · ${reference.referenceLabel || reference.key}`
          : '创建冠军参考'}
      </summary>
      {reference && (
        <p>
          来源：{reference.sourceNote}；性质：{sourceNatureLabel[reference.sourceNature]}；有效期：
          {reference.effectiveFrom || '未配置'} — {reference.effectiveTo || '长期'}
          。修改创建新版本，保留历史。
        </p>
      )}
      <form onSubmit={submit} className="physical-champion-editor">
        {fields.map(([name, label, initial]) => (
          <label key={name} htmlFor={`${id}-${name}`}>
            {label}
            <input
              id={`${id}-${name}`}
              name={name}
              defaultValue={initial}
              required={!['effectiveTo', 'protocolVersion', 'testContext'].includes(name)}
              maxLength={name === 'sourceNote' ? 500 : 200}
              type={name.startsWith('effective') ? 'date' : name === 'value' ? 'number' : 'text'}
              step={name === 'value' ? 'any' : undefined}
              min={name === 'value' ? '0.000001' : undefined}
            />
          </label>
        ))}
        {selects.map(([name, label, initial, options]) => (
          <label key={name} htmlFor={`${id}-${name}`}>
            {label}
            <select id={`${id}-${name}`} name={name} defaultValue={initial} required>
              {options.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label htmlFor={`${id}-relative`}>
          <input
            id={`${id}-relative`}
            name="weightRelative"
            type="checkbox"
            defaultChecked={reference?.weightRelative}
          />
          使用同课次体重换算相对值
        </label>
        <button type="submit" className="dashboard-action-button" disabled={saving}>
          {saving ? '保存中…' : '保存并生效'}
        </button>
        {reference && (
          <>
            <button
              type="button"
              disabled={saving || reference.reviewStatus === 'disabled'}
              onClick={() => review('disabled')}
            >
              停用此版本
            </button>
          </>
        )}
        <p role="status">{message}</p>
      </form>
    </details>
  );
}

export function PhysicalChampionModel({ project, from, to, athletes, athleteId }: Props) {
  const [payload, setPayload] = useState<PhysicalChampionPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [groupId, setGroupId] = useState('');
  const [revision, setRevision] = useState(0);
  const selectorId = useId();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .physicalChampion({ project, from, to })
      .then((result) => {
        if (active) setPayload(result);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : '冠军参考加载失败。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project, from, to, revision]);
  const showLoading =
    loading &&
    (!payload || payload.project !== project || payload.from !== from || payload.to !== to);
  const selectedAthlete = athletes.find((item) => item.id === athleteId);
  const athleteGroup = athleteId
    ? payload?.groups.find((item) =>
        item.athletes.some((athlete) => athlete.athleteId === athleteId)
      )
    : undefined;
  const group =
    athleteGroup ?? payload?.groups.find((item) => item.id === groupId) ?? payload?.groups[0];
  const scopeName = athleteId ? (selectedAthlete?.name ?? '当前运动员') : '团队平均';
  return (
    <ChartCard
      title="体能冠军参考模型"
      description={`${projectLabel(project)} · ${from} — ${to}`}
      className="physical-champion"
    >
      <div aria-live="polite">
        {showLoading && <ContentState kind="loading" title="正在加载冠军参考模型" />}
        {error && (
          <ContentState
            kind="error"
            title="冠军参考加载失败"
            description={error}
            action={
              <button type="button" onClick={() => setRevision((value) => value + 1)}>
                重试
              </button>
            }
          />
        )}
      </div>
      {!showLoading && !error && !group && (
        <ContentState
          kind="empty"
          title="待参考"
          description={payload?.pendingReason || '当前项目尚未配置适用参考模型'}
        />
      )}
      {!showLoading && !error && group && (
        <>
          <div className="physical-champion-toolbar">
            <span>{scopeName}</span>
            {payload && payload.groups.length > 1 ? (
              <>
                <label htmlFor={selectorId}>参考分组</label>
                <select
                  id={selectorId}
                  value={group.id}
                  disabled={Boolean(athleteGroup)}
                  onChange={(event) => setGroupId(event.target.value)}
                >
                  {payload.groups.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <span>{group.label}</span>
            )}
          </div>
          <PhysicalChampionOverview group={group} athleteId={athleteId} scopeName={scopeName} />
        </>
      )}
      {!showLoading && !error && payload?.canEdit && (
        <details className="physical-champion-management">
          <summary>管理参考标准</summary>
          <ReferenceEditor project={project} onSaved={() => setRevision((value) => value + 1)} />
          {payload.managementReferences.map((reference) => (
            <ReferenceEditor
              key={`${reference.id}-${reference.revision}`}
              reference={reference}
              project={project}
              onSaved={() => setRevision((value) => value + 1)}
            />
          ))}
        </details>
      )}
    </ChartCard>
  );
}
