import { ACTIVITY_LABELS, isActivityCode } from '../../shared/sport-rules';
import { projectSpecialTraining } from '../../shared/project-special-training';
import { projectLabel } from '../../shared/projects';
import type { TrainingRecord } from '../types';
import { formatNumber } from '../utils';
import { AppCard, ContentState } from './PageLayout';

type Props = { project: string; records: TrainingRecord[] };
const factNumber = (value: number | null | undefined) => value == null ? '—' : formatNumber(value);
export function ProjectSpecialTraining({ project, records }: Props) {
  const { rows, groups, summary } = projectSpecialTraining(project, records);
  return <AppCard>
    <h3>{projectLabel(project)}专项训练</h3>
    <p>专项读取已确认项目的有效课次，按实际活动分组。身体测量、恢复和通用体能测试在公共模块维护。</p>
    {!rows.length ? <ContentState kind="empty" title="暂无已确认项目的有效专项记录" description="历史归属待核实的记录不会被自动归到当前项目。" /> : <>
      <dl className="profile-metrics">
        <div><dt>课次数</dt><dd>{summary.sessions}</dd></div>
        <div><dt>有效时长（分钟）</dt><dd>{factNumber(summary.duration)}</dd></div>
        <div><dt>有效距离（公里）</dt><dd>{factNumber(summary.distance)}</dd></div>
        <div><dt>SRPE（AU）</dt><dd>{factNumber(summary.srpe)}</dd></div>
      </dl>
      <p>SRPE 有效时长与 RPE 覆盖 {summary.loadSampleCount}/{summary.sessions} 课次。以下展示最近 100 条课次实测值；课次平均功率不代表瞬时峰值或功率曲线。缺失显示“—”。</p>
      {groups.map(group=><section key={group.activity}><h4>{isActivityCode(group.activity)?ACTIVITY_LABELS[group.activity]:'待核实活动'}</h4>{!group.fields.length&&group.activity==='unknown'&&<p>活动待核实，不将原始指标归入水上或骑行比较。</p>}<div className="table-scroll" tabIndex={0} role="region" aria-label={`${projectLabel(project)}专项课次实测，可横向滚动`}><table className="data-table"><caption>{projectLabel(project)}专项课次实测</caption>
        <thead><tr><th scope="col">日期</th><th scope="col">运动员</th><th scope="col">内容</th><th scope="col">时长 min</th><th scope="col">RPE</th>{group.fields.map(field => <th key={field.key} scope="col">{field.label} {field.unit}</th>)}</tr></thead>
        <tbody>{[...group.rows].sort((a,b) => b.date.localeCompare(a.date)).slice(0,100).map(row => <tr key={row.id}>
          <td>{row.date}</td><td>{row.athleteName}</td><td>{row.content}</td><td>{factNumber(row.durationReported ? row.durationMin : null)}</td><td>{factNumber(row.rpe)}</td>
          {group.fields.map(field => <td key={field.key}>{factNumber(row[field.key])}</td>)}
        </tr>)}</tbody>
      </table></div></section>)}
    </>}
  </AppCard>;
}
