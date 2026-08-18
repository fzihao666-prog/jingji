import {
  Activity,
  AlertTriangle,
  CalendarClock,
  HeartPulse,
  LoaderCircle,
  Plus,
  ShieldCheck,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { api } from '../api';
import type { Athlete, InjuryRecord, InjuryStatus, User } from '../types';
import { formatDate, toIsoDate } from '../utils';

type Props = { athlete: Athlete; user: User };

const statusMeta: Record<InjuryStatus, { label: string; color: string; description: string }> = {
  healthy: { label: '健康', color: '#16978d', description: '当前没有训练限制' },
  observation: { label: '观察中', color: '#d79a16', description: '需要持续关注症状变化' },
  restricted: { label: '限制训练', color: '#e17636', description: '按训练限制调整计划' },
  rehab: { label: '康复中', color: '#397da6', description: '正在执行恢复安排' },
  suspended: { label: '暂停训练', color: '#d44c3e', description: '暂停相关训练并等待复查' }
};

const sideLabels: Record<InjuryRecord['side'], string> = {
  left: '左侧', right: '右侧', bilateral: '双侧', center: '中间', unspecified: '未区分'
};

const emptyForm = () => ({
  injuryName: '',
  bodyPart: '肩部',
  side: 'unspecified' as InjuryRecord['side'],
  status: 'observation' as InjuryStatus,
  painScore: 0,
  onsetDate: toIsoDate(new Date()),
  restrictions: '',
  rehabPlan: '',
  reviewDate: '',
  note: ''
});

export function InjuryRecoveryModule({ athlete, user }: Props) {
  const [records, setRecords] = useState<InjuryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(emptyForm);
  const isAthlete = user.role === 'ATL';
  const current = records[0] || null;
  const currentMeta = statusMeta[current?.status || 'healthy'];
  const visibleRecords = expanded ? records : records.slice(0, 4);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage('');
    api.injuryRecords(athlete.id)
      .then(({ records: nextRecords }) => { if (!cancelled) setRecords(nextRecords); })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : '伤病记录读取失败。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [athlete.id]);

  const reviewNotice = useMemo(() => {
    if (!current?.reviewDate) return '';
    const days = Math.ceil((Date.parse(`${current.reviewDate}T12:00:00`) - Date.now()) / 86400000);
    if (days < 0) return `复查日期已过${Math.abs(days)}天`;
    if (days === 0) return '今天需要复查';
    return `${days}天后复查`;
  }, [current]);

  const openDialog = () => {
    setForm(emptyForm());
    setMessage('');
    setDialogOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const result = await api.createInjuryRecord(athlete.id, form);
      setRecords((currentRecords) => [result.record, ...currentRecords]);
      setDialogOpen(false);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '记录保存失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="injury-recovery-module">
      <header className="injury-module-heading">
        <div className="injury-title-lockup">
          <span><HeartPulse size={20} /></span>
          <div><small>INJURY & RECOVERY</small><h2>伤病与恢复</h2><p>记录当前状态、训练限制和恢复进程</p></div>
        </div>
        <button type="button" className="secondary-button" onClick={openDialog}>
          <Plus size={16} />{isAthlete ? '提交疼痛反馈' : '新增伤病记录'}
        </button>
      </header>

      {loading ? (
        <div className="injury-module-loading"><LoaderCircle className="spin" size={25} />正在读取健康记录</div>
      ) : (
        <div className="injury-module-body">
          <div className="injury-current-panel" style={{ '--injury-color': currentMeta.color } as CSSProperties}>
            <div className="injury-state-block">
              <span>当前状态</span>
              <strong>{current ? currentMeta.label : '暂无记录'}</strong>
              <small>{current ? currentMeta.description : '尚未录入伤病或恢复信息'}</small>
            </div>
            {current ? (
              <>
                <div className="injury-current-name">
                  <span>{current.recordType === 'feedback' ? '运动员反馈' : '当前问题'}</span>
                  <strong>{current.injuryName}</strong>
                  <small>{sideLabels[current.side]} · {current.bodyPart} · 疼痛 {current.painScore}/10</small>
                </div>
                <div className="injury-current-review">
                  <CalendarClock size={18} />
                  <span><small>复查安排</small><strong>{current.reviewDate ? formatDate(current.reviewDate) : '暂未设置'}</strong>{reviewNotice && <em>{reviewNotice}</em>}</span>
                </div>
              </>
            ) : (
              <div className="injury-clear-state"><ShieldCheck size={27} /><span>建立第一条记录后，可持续追踪恢复变化。</span></div>
            )}
          </div>

          {current && (
            <div className="injury-guidance-grid">
              <article><span>训练限制</span><p>{current.restrictions || (current.recordType === 'feedback' ? '等待教练确认训练限制' : '未设置限制')}</p></article>
              <article><span>恢复安排</span><p>{current.rehabPlan || (current.recordType === 'feedback' ? '等待教练制定恢复安排' : '未填写恢复计划')}</p></article>
              <article><span>补充说明</span><p>{current.note || '无补充说明'}</p></article>
            </div>
          )}

          <div className="injury-history-panel">
            <div className="injury-history-heading"><div><Activity size={16} /><strong>历史记录</strong></div><small>新增记录不会覆盖以前的内容</small></div>
            {visibleRecords.length ? (
              <div className="injury-timeline">
                {visibleRecords.map((record) => {
                  const meta = statusMeta[record.status];
                  return (
                    <article key={record.id} style={{ '--injury-color': meta.color } as CSSProperties}>
                      <i />
                      <time>{formatDate(record.onsetDate)}</time>
                      <div><strong>{record.injuryName}</strong><span>{sideLabels[record.side]} · {record.bodyPart} · 疼痛 {record.painScore}/10</span></div>
                      <b>{record.recordType === 'feedback' ? '待确认' : meta.label}</b>
                      <small>{record.createdBy}记录</small>
                    </article>
                  );
                })}
              </div>
            ) : <div className="injury-history-empty"><AlertTriangle size={18} />暂无历史记录</div>}
            {records.length > 4 && <button className="injury-history-more" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? '收起记录' : `查看全部${records.length}条记录`}</button>}
          </div>
        </div>
      )}

      {message && <div className={message.includes('已') ? 'injury-message success' : 'injury-message'}>{message}</div>}

      {dialogOpen && (
        <div className="injury-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDialogOpen(false); }}>
          <section className="injury-dialog" role="dialog" aria-modal="true" aria-labelledby="injury-dialog-title">
            <header>
              <div><small>{isAthlete ? 'PAIN FEEDBACK' : 'HEALTH RECORD'}</small><h2 id="injury-dialog-title">{isAthlete ? '提交疼痛反馈' : '新增伤病与恢复记录'}</h2></div>
              <button type="button" aria-label="关闭" disabled={saving} onClick={() => setDialogOpen(false)}><X size={18} /></button>
            </header>
            <form onSubmit={submit}>
              <div className="injury-form-grid">
                <label><span>伤病部位</span><select value={form.bodyPart} onChange={(event) => setForm({ ...form, bodyPart: event.target.value })}>{['肩部','肘部','腕部','腰背部','髋部','膝部','踝部','颈部','其他'].map((part) => <option key={part}>{part}</option>)}</select></label>
                <label><span>身体侧别</span><select value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value as InjuryRecord['side'] })}><option value="unspecified">未区分</option><option value="left">左侧</option><option value="right">右侧</option><option value="bilateral">双侧</option><option value="center">中间</option></select></label>
                <label className="wide"><span>{isAthlete ? '不适情况' : '问题名称或诊断'}</span><input required maxLength={80} placeholder={isAthlete ? '例如：划桨时右肩疼痛' : '例如：右肩袖劳损'} value={form.injuryName} onChange={(event) => setForm({ ...form, injuryName: event.target.value })} /></label>
                <label><span>首次出现日期</span><input required type="date" value={form.onsetDate} onChange={(event) => setForm({ ...form, onsetDate: event.target.value })} /></label>
                <label><span>疼痛评分（0—10）</span><input required type="number" min="0" max="10" step="1" value={form.painScore} onChange={(event) => setForm({ ...form, painScore: Number(event.target.value) })} /></label>
                {!isAthlete && <label><span>当前状态</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as InjuryStatus })}>{Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>}
                {!isAthlete && <label><span>复查日期</span><input type="date" min={form.onsetDate} value={form.reviewDate} onChange={(event) => setForm({ ...form, reviewDate: event.target.value })} /></label>}
                {!isAthlete && <label className="wide"><span>训练限制</span><textarea maxLength={500} placeholder="例如：暂停大重量卧拉，水上训练控制在U2以下" value={form.restrictions} onChange={(event) => setForm({ ...form, restrictions: event.target.value })} /></label>}
                {!isAthlete && <label className="wide"><span>恢复安排</span><textarea maxLength={500} placeholder="填写康复动作、频次及阶段目标" value={form.rehabPlan} onChange={(event) => setForm({ ...form, rehabPlan: event.target.value })} /></label>}
                <label className="wide"><span>补充说明</span><textarea maxLength={800} placeholder={isAthlete ? '描述什么时候疼、哪些动作会加重' : '填写检查结果或其他注意事项'} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
              </div>
              <footer><p>{isAthlete ? '提交后由教练确认，运动员不能修改正式伤病记录。' : '保存后形成新的历史记录，不覆盖以前的数据。'}</p><button type="button" className="secondary-button" disabled={saving} onClick={() => setDialogOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{isAthlete ? '提交反馈' : '保存记录'}</button></footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
