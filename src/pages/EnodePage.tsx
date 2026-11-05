import { useState } from 'react';
import { EnodeTrends } from '../components/EnodeTrends';
import { PageContainer, PageHeader } from '../components/PageLayout';
import type { Athlete } from '../types';
import type { StrengthPageKey } from '../components/AppShell';
import type { EnodeKind } from '../../shared/enode';

export function EnodeAthletePanel({
  athletes,
  athleteId,
  project,
  from,
  to,
  kind = 'measurement',
}: {
  athletes: Athlete[];
  athleteId: number | null;
  project?: string;
  from: string;
  to: string;
  kind?: EnodeKind;
}) {
  const [chosen, setChosen] = useState(athleteId || athletes[0]?.id || 0);
  const selected =
    athletes.find((a) => a.id === chosen) ||
    athletes.find((a) => a.id === athleteId) ||
    athletes[0];
  return (
    <section aria-label="Enode 运动员分析">
      <div className="enode-filters">
        <label>
          <span>Enode 运动员</span>
          <select value={selected?.id || ''} onChange={(e) => setChosen(Number(e.target.value))}>
            {!athletes.length && <option value="">暂无可访问的运动员</option>}
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.team}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selected ? (
        <EnodeTrends
          key={`${selected.id}:${selected.project}:${from}:${to}:${kind}`}
          athleteId={selected.id}
          project={project || selected.project}
          from={from}
          to={to}
          kind={kind}
        />
      ) : (
        <p>当前范围没有运动员。</p>
      )}
    </section>
  );
}
export function EnodePage({
  athletes,
  athleteId,
  project,
  from,
  to,
  onNavigate,
}: {
  athletes: Athlete[];
  athleteId: number | null;
  project: string;
  from: string;
  to: string;
  onNavigate: (page: StrengthPageKey) => void;
}) {
  return (
    <PageContainer>
      <PageHeader eyebrow="ENODE VBT" title="Enode VBT" />
      <nav className="strength-category-tabs" aria-label="体能分析视图">
        <button type="button" onClick={() => onNavigate('strength-overview')}>
          训练总览
        </button>
        <button type="button" onClick={() => onNavigate('strength-analysis')}>
          训练分析
        </button>
        <button type="button" onClick={() => onNavigate('strength-assessment')}>
          体能评估
        </button>
        <button type="button" className="active" aria-current="page">
          Enode VBT
        </button>
      </nav>
      <p>按运动员和动作查看原始测量变化。周期跟随页面日期筛选，未测量指标保留空状态。</p>
      <EnodeAthletePanel
        athletes={athletes}
        athleteId={athleteId}
        project={project}
        from={from}
        to={to}
      />
    </PageContainer>
  );
}
