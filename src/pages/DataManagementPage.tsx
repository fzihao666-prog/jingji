import { useEffect, useState } from 'react';
import { Database, Plus, Save, Tags } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';

type Props = { user: User };
type Metric = { code: string; label: string; domain: string; unit: string; direction: string; frequency: string; active: number };
type Alias = { alias: string; metricCode: string; canonicalLabel: string; unit: string; side: string };

export function DataManagementPage({ user }: Props) {
  const [metrics, setMetrics] = useState<Metric[]>([]); const [aliases, setAliases] = useState<Alias[]>([]);
  const [standards, setStandards] = useState<Awaited<ReturnType<typeof api.dataManagementStandards>> | null>(null);
  const [message, setMessage] = useState(''); const [alias, setAlias] = useState(''); const [metricCode, setMetricCode] = useState('');
  const editable = user.role === 'TD' || user.role === 'DMD';
  const load = async () => {
    const [dictionary, standard] = await Promise.all([api.dataManagementMetrics(), api.dataManagementStandards()]);
    setMetrics(dictionary.metrics); setAliases(dictionary.aliases); setStandards(standard); setMetricCode((value) => value || dictionary.metrics.find((item) => item.active)?.code || '');
  };
  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : '数据管理加载失败。')); }, []);
  const saveAlias = async () => {
    try { await api.saveMetricAlias({ alias, metricCode }); setAlias(''); setMessage('指标别名已保存。'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败。'); }
  };
  return <section className="data-import-page">
    <header className="data-import-hero"><div><span>DATA MANAGEMENT</span><h1>数据管理</h1><p>统一维护导入暂存、指标字典、字段别名和数据质量标准；所有配置直接使用权威数据表。</p></div></header>
    {message && <p className="data-import-message">{message}</p>}
    <div className="data-import-grid">
      <section className="data-import-upload-card"><div className="data-import-card-heading"><Database size={20}/><div><strong>数据标准</strong><span>训练、测试、来源与质量状态</span></div></div>
        {standards && <div className="data-import-safety"><div><strong>权威对象</strong><span>{standards.athlete.join('、')}</span><strong>训练强度体系</strong><span>{standards.training.zoneSystems.join('；')}</span><strong>质量状态</strong><span>{standards.qualities.join('、')}</span><strong>已退役表</strong><span>{standards.retiredTables.join('、')}</span></div></div>}
      </section>
      <section className="data-import-upload-card"><div className="data-import-card-heading"><Tags size={20}/><div><strong>指标别名</strong><span>导入时统一映射到 metric_definitions</span></div></div>
        <label className="data-import-date"><span>别名</span><input value={alias} onChange={(event) => setAlias(event.target.value)} disabled={!editable} placeholder="例如：十桨最大功率"/></label>
        <label className="data-import-date"><span>标准指标</span><select value={metricCode} onChange={(event) => setMetricCode(event.target.value)} disabled={!editable}>{metrics.filter((item) => item.active).map((item) => <option key={item.code} value={item.code}>{item.label}（{item.unit || '无单位'}）</option>)}</select></label>
        <button type="button" className="data-import-primary" onClick={saveAlias} disabled={!editable || !alias || !metricCode}><Plus size={16}/>保存别名</button>
      </section>
    </div>
    <section className="data-import-review"><div className="data-import-review-head"><div><h2>指标字典</h2><p>动态测试指标唯一来源：metric_definitions</p></div><button type="button" onClick={() => load()}><Save size={15}/>刷新</button></div>
      <div className="data-import-table-wrap"><table className="data-import-table"><thead><tr><th>编码</th><th>名称</th><th>领域</th><th>单位</th><th>方向</th><th>频率</th><th>状态</th></tr></thead><tbody>{metrics.map((item) => <tr key={item.code}><td>{item.code}</td><td>{item.label}</td><td>{item.domain}</td><td>{item.unit || '—'}</td><td>{item.direction}</td><td>{item.frequency}</td><td>{item.active ? '启用' : '停用'}</td></tr>)}</tbody></table></div>
      <h2>已维护别名</h2><div className="data-import-history-list">{aliases.slice(0, 80).map((item) => <button key={item.alias} type="button"><strong>{item.alias}</strong><small>{item.canonicalLabel} · {item.metricCode} · {item.unit}</small></button>)}</div>
    </section>
  </section>;
}
