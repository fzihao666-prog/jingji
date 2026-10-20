import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { EChartsOption } from 'echarts';
import { api } from '../api';
import { EChart } from './EChart';
import { projectLabel } from '../../shared/projects';
import {
  emptyReportCommentary,
  reportPeriod,
  reportRangeSchema,
  reportCommentarySchema,
  type ReportRange,
  type ReportPreview,
  type ReportData,
  type ReportHistory,
  type ReportCommentary,
} from '../../shared/training-report';
import './TrainingReport.css';

const number = (value: number | null) =>
  value === null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
const kinds = { week: '周报告', month: '月报告', custom: '阶段报告' };
const commentaryLabels = {
  highlights: '主要表现',
  concerns: '需要关注',
  suggestions: '下一步建议',
} as const;
const chart = (dates: string[], series: EChartsOption['series'], unit: string): EChartsOption => ({
  tooltip: { trigger: 'axis', renderMode: 'richText' },
  legend: { bottom: 0 },
  grid: { left: 48, right: 20, top: 30, bottom: 65 },
  xAxis: { type: 'category', data: dates.map((d) => d.slice(5)) },
  yAxis: { type: 'value', name: unit },
  series,
});
type FiguresProps = { data: ReportData };
export function TrainingReportFigures({ data }: FiguresProps) {
  const metrics = [
    { key: 'sessions', label: '训练课次', unit: '次', coverage: null },
    { key: 'duration', label: '训练时长', unit: '分钟', coverage: data.totals.durationCount },
    { key: 'distance', label: '训练距离', unit: 'km', coverage: data.totals.distanceCount },
    { key: 'srpe', label: 'SRPE 负荷', unit: 'AU', coverage: data.totals.srpeCount },
  ] as const;
  return (
    <>
      <div className="training-report-kpis">
        {metrics.map((m) => (
          <div key={m.key}>
            <span>{m.label}</span>
            <strong>
              {number(data.totals[m.key])}
              <small>{m.unit}</small>
            </strong>
            <small>前一等长区间：{number(data.previous[m.key])}</small>
            {m.coverage !== null && (
              <small>
                有效填报 {m.coverage}/{data.totals.sessions} 课次
              </small>
            )}
          </div>
        ))}
      </div>
      <p className="training-report-note">
        记录覆盖：训练 {data.trainingDays}/{data.days} 天 · 恢复日报 {data.wellnessDays}/{data.days}{' '}
        天。覆盖不是完成率；“—”表示无有效数据，不代表零。前期记录可能不完整。
      </p>
      <div className="training-report-grid">
        <section>
          <h3>
            训练结构 <small>分钟</small>
          </h3>
          {!data.totals.sessions && <p>当前范围暂无有效训练记录</p>}
          <EChart
            label="每日训练分类时长，下方表格可查看汇总与每日明细"
            option={chart(
              data.daily.map((d) => d.date),
              data.categories.map((c) => ({
                name: c.label,
                type: 'bar',
                stack: 'duration',
                data: data.daily.map(
                  (d) => d[c.key as 'special' | 'physical' | 'recovery' | 'other']
                ),
              })),
              '分钟'
            )}
          />
          <table>
            <thead>
              <tr>
                <th>类型</th>
                <th>课次</th>
                <th>分钟</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td>{c.sessions}</td>
                  <td>{number(c.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>
            每日负荷 <small>SRPE · AU</small>
          </h3>
          <EChart
            label="每日 SRPE 负荷趋势，缺失日期断开；明细见下方"
            option={chart(
              data.daily.map((d) => d.date),
              [
                {
                  name: 'SRPE',
                  type: 'line',
                  connectNulls: false,
                  data: data.daily.map((d) => d.srpe),
                },
              ],
              'AU'
            )}
          />
          <p className="training-report-note">
            只汇总有效时长且有 RPE 的课次；缺失记录不补零，不生成风险阈值。
          </p>
          <details>
            <summary>查看每日数值</summary>
            <div className="training-report-table">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>课次</th>
                    <th>分钟</th>
                    <th>SRPE</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{d.sessions}</td>
                      <td>{number(d.duration)}</td>
                      <td>{number(d.srpe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
      <section>
        <h3>测试变化</h3>
        <p className="training-report-note">
          周期内首次 →
          末次；按相同指标、单位和侧别汇总，不要求填写协议。变化仅表示数值差，不自动判为进步。
        </p>
        {data.tests.length ? (
          <div className="training-report-table">
            <table>
              <thead>
                <tr>
                  <th>指标 / 协议</th>
                  <th>首次</th>
                  <th>末次</th>
                  <th>变化</th>
                </tr>
              </thead>
              <tbody>
                {data.tests.map((t) => (
                  <tr key={t.key}>
                    <td>
                      {t.label}（{t.unit}）
                      <small>
                        {t.protocol || '协议未记录'} ·{' '}
                        {(
                          {
                            left: '左侧',
                            right: '右侧',
                            center: '中立',
                            bilateral: '双侧',
                          } as Record<string, string>
                        )[t.side] || t.side}
                      </small>
                      <details>
                        <summary>历史数值</summary>
                        {t.points.map((p, i) => (
                          <div key={i}>
                            {p.date} · {number(p.value)} {t.unit}
                          </div>
                        ))}
                      </details>
                    </td>
                    <td>
                      {number(t.first.value)}
                      <small>{t.first.date}</small>
                    </td>
                    <td>
                      {number(t.last.value)}
                      <small>{t.last.date}</small>
                    </td>
                    <td>
                      {t.change !== null && t.change > 0 ? '+' : ''}
                      {number(t.change)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="training-report-empty">当前范围暂无有效测试；单次测试不计算变化。</p>
        )}
      </section>
      <section>
        <h3>恢复趋势</h3>
        <div className="training-report-grid">
          {data.wellness.map((w) => (
            <section key={w.key}>
              <h4>
                {w.label} · 均值 {number(w.average)} {w.unit}
              </h4>
              <small>
                有效记录 {w.days}/{data.days} 天
              </small>
              <EChart
                label={`${w.label}趋势，以下可展开精确数据`}
                option={chart(
                  data.daily.map((d) => d.date),
                  [
                    {
                      name: w.label,
                      type: 'line',
                      connectNulls: false,
                      data: data.daily.map(
                        (d) => w.points.find((p) => p.date === d.date)?.value ?? null
                      ),
                    },
                  ],
                  w.unit
                )}
              />
              {!w.days && <p>暂无有效记录</p>}
              <details>
                <summary>查看数值</summary>
                {w.points.map((p) => (
                  <p key={p.date}>
                    {p.date} · {number(p.value)} {w.unit}
                  </p>
                ))}
              </details>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}

type Props = { athleteId: number; athleteName: string; initialDate: string };
export function TrainingReport({ athleteId, athleteName, initialDate }: Props) {
  const [range, setRange] = useState<ReportRange>(() => reportPeriod('week', initialDate));
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [commentary, setCommentary] = useState(emptyReportCommentary);
  const [history, setHistory] = useState<ReportHistory>([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [saved, setSaved] = useState(''),
    [consent, setConsent] = useState(false);
  const [printing, setPrinting] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error ? error.message : '请求失败，请重试。');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function updateRange(next: ReportRange) {
    setRange(next);
    setPreview(null);
    setSaved('');
    setCommentary(emptyReportCommentary());
    setMessage('');
  }
  const load = () =>
    action(async () => {
      if (!reportRangeSchema.safeParse(range).success)
        throw new Error('请选择有效日期，最长 90 天。');
      const result = await api.reportPreview(athleteId, range);
      if (alive.current) {
        setPreview(result);
        setCommentary(emptyReportCommentary());
        setSaved('');
      }
    });
  const generate = () =>
    action(async () => {
      if (!preview || !consent) return;
      const result = await api.reportCommentary(athleteId, preview.data.range, preview.fingerprint);
      if (alive.current) {
        setCommentary(result);
        setMessage('AI 草稿已生成，请核对后保存。');
      }
    });
  const save = () =>
    action(async () => {
      if (!preview) return;
      const normalized = reportCommentarySchema.safeParse(
        Object.fromEntries(
          Object.entries(commentary).map(([key, lines]) => [
            key,
            lines.map((line) => line.trim()).filter(Boolean),
          ])
        )
      );
      if (!normalized.success) throw new Error('每类最多两条，每条最多 100 字，总计最多 250 字。');
      const result = await api.saveReport(
        athleteId,
        preview.data.range,
        preview.fingerprint,
        normalized.data
      );
      if (alive.current) {
        setCommentary(result.commentary);
        setSaved(result.createdAt);
        setMessage('报告已确认保存，两端可在历史报告中查看。');
      }
    });
  return (
    <section className="training-report" data-printing={printing} aria-label="训练报告">
      <header>
        <span>TRAINING REPORT</span>
        <h2>
          {athleteName} · {kinds[preview?.data.range.kind || range.kind]}
        </h2>
        {preview && (
          <p>
            {projectLabel(preview.data.project)} · {preview.data.range.from} —{' '}
            {preview.data.range.to}
          </p>
        )}
        <small>
          {saved ? `已确认 · ${new Date(saved).toLocaleString('zh-CN')}` : '预览草稿 · 核对后保存'}
        </small>
      </header>
      <fieldset disabled={busy} className="training-report-controls">
        <legend>报告范围</legend>
        <label>
          报告类型
          <select
            value={range.kind}
            onChange={(e) =>
              updateRange(
                reportPeriod(e.target.value as ReportRange['kind'], range.from || initialDate)
              )
            }
          >
            {Object.entries(kinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {range.kind === 'custom' ? '开始日期' : '所在周 / 月的日期'}
          <input
            type="date"
            value={range.from}
            onChange={(e) =>
              updateRange(
                range.kind === 'custom'
                  ? { ...range, from: e.target.value }
                  : e.target.value
                    ? reportPeriod(range.kind, e.target.value)
                    : { ...range, from: '' }
              )
            }
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={range.to}
            disabled={range.kind !== 'custom'}
            onChange={(e) => updateRange({ ...range, to: e.target.value })}
          />
        </label>
        <button type="button" onClick={load}>
          预览图表
        </button>
        <button
          type="button"
          onClick={() =>
            action(async () => {
              const list = await api.reportHistory(athleteId);
              if (alive.current) {
                setHistory(list);
                if (!list.length) setMessage('暂无历史报告。');
              }
            })
          }
        >
          历史报告
        </button>
      </fieldset>
      <div role="status" aria-live="polite">
        {busy ? '正在处理，请稍候…' : message}
      </div>
      {!!history.length && (
        <details className="training-report-controls" open>
          <summary>最近 50 份已确认报告</summary>
          {history.map((h) => (
            <button
              key={h.id}
              type="button"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const result = await api.reportDetail(athleteId, h.id);
                  if (alive.current) {
                    setPreview({ data: result.data, fingerprint: '' });
                    setRange(result.data.range);
                    setCommentary(result.commentary);
                    setSaved(result.createdAt);
                  }
                })
              }
            >
              {h.from} — {h.to} · {new Date(h.createdAt).toLocaleString('zh-CN')}
            </button>
          ))}
        </details>
      )}
      {preview ? (
        <>
          <TrainingReportFigures data={preview.data} />
          <section>
            <h3>
              简短点评 <small>{saved ? '已确认' : '待人工核对'}</small>
            </h3>
            {!saved && (
              <div className="training-report-controls">
                <label className="training-report-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={busy}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  同意将去身份化训练汇总发送至配置的大模型。不发送姓名、联系方式、伤病和恢复健康数据。
                </label>
                <button
                  type="button"
                  disabled={busy || !consent || !preview.data.totals.sessions}
                  onClick={generate}
                >
                  生成 AI 点评
                </button>
              </div>
            )}
            <div className="training-report-grid">
              {(Object.keys(commentaryLabels) as (keyof ReportCommentary)[]).map((key) => (
                <label key={key}>
                  {commentaryLabels[key]}
                  {saved ? (
                    <ul>
                      {commentary[key].length ? (
                        commentary[key].map((s, i) => <li key={i}>{s}</li>)
                      ) : (
                        <li>未填写</li>
                      )}
                    </ul>
                  ) : (
                    <textarea
                      aria-label={commentaryLabels[key]}
                      disabled={busy}
                      value={commentary[key].join('\n')}
                      maxLength={201}
                      placeholder="每行一条，最多两条；可手动填写或留空"
                      onChange={(e) =>
                        setCommentary({
                          ...commentary,
                          [key]: e.target.value.split('\n'),
                        })
                      }
                    />
                  )}
                </label>
              ))}
            </div>
            <p className="training-report-note">
              AI
              内容仅供参考，不作伤病诊断，不自动调整训练计划。保存后是当时数据快照，训练补录不会改写历史报告。
            </p>
          </section>
          <div className="training-report-controls">
            {!saved && (
              <button type="button" disabled={busy} onClick={save}>
                确认并保存报告
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                flushSync(() => setPrinting(true));
                try {
                  window.print();
                } finally {
                  setPrinting(false);
                }
              }}
            >
              打印 / 保存为 PDF
            </button>
          </div>
        </>
      ) : (
        <p className="training-report-empty">
          选择范围后预览：训练结构、负荷趋势、测试变化和恢复图表。
        </p>
      )}
    </section>
  );
}
