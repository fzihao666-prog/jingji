import { useEffect, useRef, useState } from 'react';
import { Database, Plus, RefreshCw, Tags } from 'lucide-react';
import { api } from '../api';
import type { Project, ProjectTeam, User } from '../types';
import { TestTemplatePanel } from '../components/TestTemplatePanel';
import { PageContainer, PageHeader } from '../components/PageLayout';
import './DataImportPage.css';

type Props = { user: User; project: Project; teamId?: number | null };
type ImportedTest = Awaited<ReturnType<typeof api.dataManagementImportedTests>>['items'][number];
type Metric = {
  code: string;
  label: string;
  domain: string;
  unit: string;
  direction: string;
  frequency: string;
  active: number;
};
type Alias = {
  alias: string;
  metricCode: string;
  canonicalLabel: string;
  unit: string;
  side: string;
};

export function DataManagementPage({ user, project, teamId }: Props) {
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const templateButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api.adminTeams().then(({ teams }) => {
      if (cancelled) return;
      const scoped = teams.filter(team => team.project === project);
      setTeams(scoped);
      setSelectedTeam(scoped.find(team => team.id === teamId)?.name ?? scoped[0]?.name ?? '');
      setTeamsLoaded(true);
    }, () => { if (!cancelled) setTeamError('队伍读取失败，请刷新页面重试。'); });
    return () => { cancelled = true; };
  }, [project, teamId]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [standards, setStandards] = useState<Awaited<
    ReturnType<typeof api.dataManagementStandards>
  > | null>(null);
  const [message, setMessage] = useState('');
  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const [savingMetric, setSavingMetric] = useState(false);
  const [alias, setAlias] = useState('');
  const [metricCode, setMetricCode] = useState('');
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [importedTests, setImportedTests] = useState<ImportedTest[]>([]);
  const [importedTestSearch, setImportedTestSearch] = useState('');
  const [importedTestStatus, setImportedTestStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const testKeyword = importedTestSearch.trim().toLowerCase();
  const visibleImportedTests = importedTests.filter((item) =>
    [item.projectName, item.testType, item.metricName, item.metricCode, item.unit, item.protocol, item.protocolVersion]
      .some((value) => value.toLowerCase().includes(testKeyword))
  );
  const editable = user.role === 'TD' || user.role === 'DMD';
  const domains = [...new Set(metrics.map((item) => item.domain))].sort();
  const keyword = search.trim().toLowerCase();
  const matchingAliases = aliases.filter((item) => item.alias.toLowerCase().includes(keyword));
  const aliasCodes = new Set(matchingAliases.map((item) => item.metricCode));
  const visibleMetrics = metrics.filter((item) =>
    (!domain || item.domain === domain) &&
    (!status || Boolean(item.active) === (status === 'active')) &&
    (!keyword || [item.code, item.label].some((value) => value.toLowerCase().includes(keyword)) ||
      aliasCodes.has(item.code))
  );
  const visibleMetricCodes = new Set(visibleMetrics.map((item) => item.code));
  const visibleAliases = aliases.filter((item) => visibleMetricCodes.has(item.metricCode));
  const load = async () => {
    const [dictionary, standard] = await Promise.all([
      api.dataManagementMetrics(),
      api.dataManagementStandards(),
    ]);
    setMetrics(dictionary.metrics);
    setAliases(dictionary.aliases);
    setStandards(standard);
    setMetricCode((value) => value || dictionary.metrics.find((item) => item.active)?.code || '');
  };
  useEffect(() => {
    load()
      .catch((error) => setMessage(error instanceof Error ? error.message : '指标与标准加载失败。'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    let ignore = false;
    setImportedTests([]);
    setImportedTestStatus('loading');
    api.dataManagementImportedTests().then(
      ({ items }) => {
        if (ignore) return;
        setImportedTests(items);
        setImportedTestStatus('ready');
      },
      () => { if (!ignore) setImportedTestStatus('error'); }
    );
    return () => { ignore = true; };
  }, [user.id]);
  const saveAlias = async () => {
    try {
      await api.saveMetricAlias({ alias, metricCode });
      setAlias('');
      setMessage('指标别名已保存。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    }
  };
  const saveMetric = async () => {
    if (!editable || !editingMetric || savingMetric) return;
    const label = editingMetric.label.trim();
    const unit = editingMetric.unit.trim();
    if (!label || label.length > 80 || unit.length > 24) {
      setMessage('请输入 1–80 字的指标名称，单位不能超过 24 字。');
      return;
    }
    setSavingMetric(true);
    try {
      await api.updateDataManagementMetric(editingMetric.code, {
        label,
        unit,
        active: Boolean(editingMetric.active),
      });
      setMetrics((items) =>
        items.map((item) =>
          item.code === editingMetric.code ? { ...editingMetric, label, unit } : item
        )
      );
      setEditingMetric(null);
      setMessage('指标字典已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '指标保存失败，请重试。');
    } finally {
      setSavingMetric(false);
    }
  };
  return (
    <PageContainer className="data-import-page">
      <PageHeader
        title="指标与标准"
      />
      <p className="data-import-message" role="status">{message}</p>
      <section className="data-import-upload-card" aria-labelledby="test-project-management-title">
        <div className="data-import-card-heading">
          <Tags size={20} aria-hidden="true" />
          <div>
            <h2 id="test-project-management-title">测试项目、指标与模板</h2>
            <span>在此创建测试项目、添加指标或配置本队测试成绩模板。</span>
          </div>
        </div>
        {teams.length > 1 && <label className="data-import-template-team">
          选择队伍
          <select value={selectedTeam} onChange={event => setSelectedTeam(event.target.value)}>
            {teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
          </select>
        </label>}
        <button ref={templateButton} type="button" className="primary-button" aria-haspopup="dialog"
          disabled={!selectedTeam} onClick={() => setTemplateOpen(true)}>
          <Tags size={16} aria-hidden="true" />
          管理测试项目与模板
        </button>
        {teamError ? <p role="alert">{teamError}</p> : teamsLoaded && !teams.length && <p>当前项目没有可管理的队伍。</p>}
      </section>
      {templateOpen && selectedTeam && <TestTemplatePanel key={selectedTeam} project={project} team={selectedTeam}
        onClose={() => {
          setTemplateOpen(false);
          requestAnimationFrame(() => templateButton.current?.focus());
          void load().catch(() => setMessage('指标字典刷新失败，请重试。'));
        }} />}
      <div className="data-import-grid">
        <section className="data-import-upload-card">
          <div className="data-import-card-heading">
            <Database size={20} />
            <div>
              <strong>数据标准</strong>
              <span>训练、测试、来源与质量状态</span>
            </div>
          </div>
          {standards && (
            <div className="data-import-safety">
              <div>
                <strong>运动员数据</strong>
                <span>{standards.athlete.join('、')}</span>
                <strong>训练类型与记录结构</strong>
                <span>{[...standards.training.types, ...standards.training.structures].join('、')}</span>
                <strong>训练强度体系</strong>
                <span>{standards.training.zoneSystems.join('；')}</span>
                <strong>测试数据</strong>
                <span>{standards.testing.join('、')}</span>
                <strong>数据来源</strong>
                <span>{standards.sources.join('、')}</span>
                <strong>质量状态</strong>
                <span>{standards.qualities.join('、')}</span>
                <strong>已退役表</strong>
                <span>{standards.retiredTables.join('、')}</span>
              </div>
            </div>
          )}
        </section>
        <section className="data-import-upload-card">
          <div className="data-import-card-heading">
            <Tags size={20} />
            <div>
              <strong>指标别名</strong>
              <span>将导入文件里的不同名称对应到同一个标准指标</span>
            </div>
          </div>
          <label className="data-import-date">
            <span>别名</span>
            <input
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              disabled={!editable}
              placeholder="例如：十桨最大功率"
            />
          </label>
          <label className="data-import-date">
            <span>标准指标</span>
            <select
              value={metricCode}
              onChange={(event) => setMetricCode(event.target.value)}
              disabled={!editable}
            >
              {metrics
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}（{item.unit || '无单位'}）
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            onClick={saveAlias}
            disabled={!editable || !alias || !metricCode}
          >
            <Plus size={16} aria-hidden="true" />
            保存别名
          </button>
        </section>
      </div>
      <section className="data-import-review" aria-labelledby="imported-test-catalog-title">
        <div className="data-import-review-head">
          <div>
            <h2 id="imported-test-catalog-title">已导入的测试项目与指标</h2>
            <p role="status">
              {importedTestStatus === 'ready' && `显示 ${visibleImportedTests.length} / ${importedTests.length} 项已入库指标`}
            </p>
          </div>
          <label className="data-import-date">
            <span>搜索导入指标</span>
            <input type="search" value={importedTestSearch}
              onChange={(event) => setImportedTestSearch(event.target.value)}
              placeholder="测试名称、指标编码或协议" />
          </label>
        </div>
        <div className="data-import-table-wrap" role="region" aria-label="已导入的测试项目与指标表" tabIndex={0}>
          <table className="data-import-table">
            <thead>
              <tr>
                {['测试项目', '指标名称与编码', '单位', '测试协议', '入库测量数', '最近测试日期']
                  .map((label) => <th key={label} scope="col">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleImportedTests.map((item) => (
                <tr key={JSON.stringify([item.testType, item.metricCode, item.unit, item.protocol, item.protocolVersion])}>
                  <td>{item.projectName}<br /><small>{item.testType}</small></td>
                  <td>{item.metricName}<br /><small>{item.metricCode}</small></td>
                  <td>{item.unit || '—'}</td>
                  <td>{[item.protocol, item.protocolVersion].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{item.measurementCount}</td>
                  <td>{item.latestTestDate}</td>
                </tr>
              ))}
              {!visibleImportedTests.length && (
                <tr><td colSpan={6}>
                  {importedTestStatus === 'loading' ? '正在读取导入指标…'
                    : importedTestStatus === 'error' ? '导入指标读取失败，请刷新页面重试。'
                    : importedTests.length ? '没有匹配的导入指标。' : '当前权限范围内暂无已入库的导入指标。'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="data-import-review">
        <div className="data-import-review-head">
          <div>
            <h2>指标字典</h2>
            <p role="status">显示 {visibleMetrics.length} / {metrics.length} 项指标</p>
          </div>
          <button
            type="button"
            onClick={() =>
              load().catch((error) =>
                setMessage(error instanceof Error ? error.message : '刷新失败。')
              )
            }
            disabled={savingMetric}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
        </div>
        <div className="metric-dictionary-filters">
          <label className="data-import-date">
            <span>搜索指标</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="名称、编码或别名" />
          </label>
          <label className="data-import-date">
            <span>领域</span>
            <select value={domain} onChange={(event) => setDomain(event.target.value)}>
              <option value="">全部领域</option>
              {domains.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="data-import-date">
            <span>状态</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部状态</option>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </label>
        </div>
        {editable && editingMetric && (
          <form
            className="data-import-upload-card"
            aria-label="编辑指标"
            onSubmit={(event) => {
              event.preventDefault();
              void saveMetric();
            }}
          >
            <strong>编辑指标：{editingMetric.code}</strong>
            <label className="data-import-date">
              <span>名称</span>
              <input
                autoFocus
                required
                maxLength={80}
                value={editingMetric.label}
                disabled={savingMetric}
                onChange={(event) =>
                  setEditingMetric({ ...editingMetric, label: event.target.value })
                }
              />
            </label>
            <label className="data-import-date">
              <span>单位</span>
              <input
                maxLength={24}
                value={editingMetric.unit}
                disabled={savingMetric}
                onChange={(event) =>
                  setEditingMetric({ ...editingMetric, unit: event.target.value })
                }
              />
            </label>
            <label className="data-import-date">
              <span>状态</span>
              <select
                value={editingMetric.active ? '1' : '0'}
                disabled={savingMetric}
                onChange={(event) =>
                  setEditingMetric({ ...editingMetric, active: Number(event.target.value) })
                }
              >
                <option value="1">启用</option>
                <option value="0">停用</option>
              </select>
            </label>
            <button className="data-import-primary" type="submit" disabled={savingMetric}>
              {savingMetric ? '保存中…' : '保存指标'}
            </button>
            <button type="button" disabled={savingMetric} onClick={() => setEditingMetric(null)}>
              取消
            </button>
          </form>
        )}
        <div className="data-import-table-wrap metric-dictionary-table-wrap">
          <table className="data-import-table metric-dictionary-table">
            <thead>
              <tr>
                <th>编码</th>
                <th>名称</th>
                <th>领域</th>
                <th>单位</th>
                <th>方向</th>
                <th>频率</th>
                <th>状态</th>
                {editable && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {visibleMetrics.length === 0 && (
                <tr><td colSpan={editable ? 8 : 7}>
                  {loading ? '正在加载指标…' : metrics.length ? '没有符合条件的指标。' : '暂无指标可展示。'}
                </td></tr>
              )}
              {visibleMetrics.map((item) => (
                <tr key={item.code}>
                  <td>{item.code}</td>
                  <td>{item.label}</td>
                  <td>{item.domain}</td>
                  <td>{item.unit || '—'}</td>
                  <td>{item.direction}</td>
                  <td>{item.frequency}</td>
                  <td>{item.active ? '启用' : '停用'}</td>
                  {editable && (
                    <td>
                      <button
                        type="button"
                        disabled={savingMetric}
                        aria-label={`编辑${item.label}（${item.code}）`}
                        onClick={() => {
                          setEditingMetric({ ...item });
                          setMessage('');
                        }}
                      >
                        编辑
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="metric-dictionary-aliases">
          <summary>当前指标的导入别名（{visibleAliases.length}）</summary>
          {visibleAliases.length ? (
            <dl>
              {visibleAliases.map((item) => (
                <div key={item.alias}>
                  <dt>{item.alias}</dt>
                  <dd>{[item.canonicalLabel, item.metricCode, item.unit, item.side].filter(Boolean).join(' · ')}</dd>
                </div>
              ))}
            </dl>
          ) : <p>当前指标没有已维护的别名。</p>}
        </details>
      </section>
    </PageContainer>
  );
}
