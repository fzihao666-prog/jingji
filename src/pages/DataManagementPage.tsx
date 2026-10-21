import { useEffect, useState } from 'react';
import { Database, Plus, Save, Tags } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';
import { PageContainer, PageHeader } from '../components/PageLayout';
import './DataImportPage.css';

type Props = { user: User };
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

export function DataManagementPage({ user }: Props) {
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
  const editable = user.role === 'TD' || user.role === 'DMD';
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
    load().catch((error) =>
      setMessage(error instanceof Error ? error.message : '数据管理加载失败。')
    );
  }, []);
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
        className="data-management-header"
        eyebrow="METRICS & STANDARDS"
        title="指标与标准"
      />
      <p className="data-import-message" role="status">
        {message}
      </p>
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
                <strong>权威对象</strong>
                <span>{standards.athlete.join('、')}</span>
                <strong>训练强度体系</strong>
                <span>{standards.training.zoneSystems.join('；')}</span>
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
              <span>导入时统一映射到 metric_definitions</span>
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
            className="data-import-primary"
            onClick={saveAlias}
            disabled={!editable || !alias || !metricCode}
          >
            <Plus size={16} />
            保存别名
          </button>
        </section>
      </div>
      <section className="data-import-review">
        <div className="data-import-review-head">
          <div>
            <h2>指标字典</h2>
            <p>动态测试指标唯一来源：metric_definitions</p>
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
            <Save size={15} />
            刷新
          </button>
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
              {metrics.map((item) => (
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
        <h2>已维护别名</h2>
        <div className="data-import-history-list">
          {aliases.slice(0, 80).map((item) => (
            <button key={item.alias} type="button">
              <strong>{item.alias}</strong>
              <small>
                {item.canonicalLabel} · {item.metricCode} · {item.unit}
              </small>
            </button>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
