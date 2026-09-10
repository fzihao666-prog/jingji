import { Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { AppCard, ContentState, SectionHeader } from './PageLayout';
import type { Project, SpecialChampionModelEvent, SpecialChampionModelPayload } from '../types';
import { CHAMPION_MODEL_STANDARD_LABELS, CHAMPION_MODEL_STANDARD_TYPES, type ChampionModelStandardType } from '../../shared/champion-model';
import { projectLabel } from '../../shared/projects';

type EventRow = {
  eventCode: string;
  eventName: string;
  standards: Partial<Record<ChampionModelStandardType, SpecialChampionModelEvent>>;
};

function eventGroups(events: SpecialChampionModelEvent[]) {
  const groups = new Map<string, Map<string, EventRow>>();
  for (const event of events) {
    const group = groups.get(event.eventGroup) || new Map<string, EventRow>();
    const row = group.get(event.eventCode) || { eventCode: event.eventCode, eventName: event.eventName, standards: {} };
    row.standards[event.standardType] = event;
    group.set(event.eventCode, row);
    groups.set(event.eventGroup, group);
  }
  return [...groups.entries()].map(([name, rows]) => ({ name, rows: [...rows.values()] }));
}

function StandardCell({ event }: { event?: SpecialChampionModelEvent }) {
  if (!event?.bestPerformance) return <span className="champion-pending">待核实</span>;
  const summary = [event.competition, event.location].filter(Boolean).join(' · ');
  const detail = [event.competition, event.location, event.competitionDate].filter(Boolean).join('\n');
  return <div className="champion-standard-cell">
    <strong>{event.bestPerformance}</strong>
    <b>{event.country || '待核实'}</b>
    {summary ? <span title={detail}>{summary}</span> : null}
  </div>;
}

export function SpecialChampionModel({ project }: { project: Project }) {
  const [model, setModel] = useState<SpecialChampionModelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignored = false;
    setLoading(true);
    setError('');
    setModel(null);
    api.specialChampionModels(project)
      .then((payload) => { if (!ignored) setModel(payload); })
      .catch((reason: unknown) => { if (!ignored) setError(reason instanceof Error ? reason.message : '冠军模型读取失败。'); })
      .finally(() => { if (!ignored) setLoading(false); });
    return () => { ignored = true; };
  }, [project]);

  const groups = useMemo(() => eventGroups(model?.events || []), [model]);
  const content = loading
    ? <ContentState kind="loading" title="正在读取冠军模型配置" />
    : error
      ? <ContentState kind="error" title="冠军模型暂不可用" description={error} />
      : !groups.length
        ? <ContentState kind="empty" title="模型数据待配置" description={`尚未配置${projectLabel(project)}的专项细分项目与标杆成绩。`} />
        : <div className="champion-model-groups">
          {groups.map((group) => <section key={group.name} className="champion-model-group">
            <h3>{group.name}</h3>
            <div className="champion-table-scroll">
              <table className="champion-model-table">
                <thead>
                  <tr>
                    <th scope="col">小项</th>
                    {CHAMPION_MODEL_STANDARD_TYPES.map((type) => <th key={type} scope="col">{CHAMPION_MODEL_STANDARD_LABELS[type]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => <tr key={row.eventCode}>
                    <th scope="row">{row.eventName}</th>
                    {CHAMPION_MODEL_STANDARD_TYPES.map((type) => <td key={type}><StandardCell event={row.standards[type]} /></td>)}
                  </tr>)}
                </tbody>
              </table>
            </div>
          </section>)}
        </div>;

  return <AppCard variant="chart" className="professional-panel special-champion-model">
    <SectionHeader
      title="冠军模型"
      description={`当前运动项目：${projectLabel(project)} · 已配置小项及三类标准同步展示`}
      icon={<Trophy size={17} />}
    />
    {content}
  </AppCard>;
}
