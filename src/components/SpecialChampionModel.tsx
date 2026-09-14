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

  const events = model?.events || [];
  const content = loading
    ? <ContentState kind="loading" title="正在读取冠军模型配置" />
    : error
      ? <ContentState kind="error" title="冠军模型暂不可用" description={error} />
      : !events.length
        ? <ContentState kind="empty" title="模型数据待配置" description={`尚未配置${projectLabel(project)}的专项细分项目与标杆成绩。`} />
        : <div className="champion-table-scroll">
            <table className="champion-model-table">
              <thead>
                <tr>
                  <th scope="col">项目</th>
                  <th scope="col">国家</th>
                  <th scope="col">最好成绩</th>
                  <th scope="col">配速</th>
                  <th scope="col">赛事</th>
                  <th scope="col">比赛地点</th>
                </tr>
              </thead>

              <tbody>
                {events.map((event) => (
                  <tr key={event.eventCode}>
                    <th scope="row">{event.eventName}</th>
                    <td>{event.country || '待核实'}</td>
                    <td>{event.bestPerformance || '待核实'}</td>
                    <td>{event.pace || '待核实'}</td>
                    <td>{event.competition || '待核实'}</td>
                    <td>{event.location || '待核实'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
