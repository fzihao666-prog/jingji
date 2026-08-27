import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, LoaderCircle, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../api';
import type { Athlete, StrengthImportPreview, StrengthImportRow } from '../types';
import {
  STRENGTH_BODY_POSITIONS,
  STRENGTH_INTENSITY_ZONES,
  STRENGTH_TRAINING_CATEGORIES,
  STRENGTH_TRAINING_ENVIRONMENTS,
  type StrengthBodyPosition,
  type StrengthIntensityZone,
  type StrengthTrainingCategory,
  type StrengthTrainingEnvironment
} from '../../shared/strength-training';

type Props = {
  athletes: Athlete[];
  onClose: () => void;
  onCommitted: () => void | Promise<void>;
};

function nullableNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function StrengthResultImportDialog({ athletes, onClose, onCommitted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StrengthImportPreview | null>(null);
  const [rows, setRows] = useState<StrengthImportRow[]>([]);
  const [policy, setPolicy] = useState<'skip' | 'update' | 'new'>('skip');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const summary = useMemo(() => ({
    invalid: rows.filter((row) => row.errors.length).length,
    duplicate: rows.filter((row) => row.duplicate).length,
    lowConfidence: rows.filter((row) => row.confidence !== null && row.confidence < 0.7).length
  }), [rows]);

  const analyze = async () => {
    if (!file) return;
    setBusy('preview');
    setMessage('');
    try {
      const result = await api.previewStrengthResults(file);
      setPreview(result);
      setRows(result.rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '训练结果识别失败。');
    } finally {
      setBusy('');
    }
  };

  const updateRow = (index: number, patch: Partial<StrengthImportRow>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch, errors: [] } : row));
  };

  const commit = async () => {
    if (!preview) return;
    setBusy('commit');
    setMessage('');
    try {
      const result = await api.commitStrengthResults(preview.token, rows, policy);
      await onCommitted();
      setMessage(result.message);
      window.setTimeout(onClose, 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '训练结果保存失败。');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="strength-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="strength-import-dialog" role="dialog" aria-modal="true" aria-labelledby="strength-import-title">
        <header>
          <div><span>RESULT INTAKE</span><h2 id="strength-import-title">导入体能训练结果</h2><p>AI负责识别，确认后的结果才会写入运动员训练记录。</p></div>
          <button type="button" className="strength-icon-button" onClick={onClose} aria-label="关闭导入"><X size={19} /></button>
        </header>

        {!preview ? (
          <div className="strength-import-start">
            <label className={`strength-dropzone ${file ? 'has-file' : ''}`}>
              <input type="file" accept=".xlsx,.csv,.jpg,.jpeg,.png,.webp,.pdf" onChange={(event) => { setFile(event.target.files?.[0] || null); setMessage(''); }} />
              {file ? <FileSpreadsheet size={32} /> : <Upload size={32} />}
              <strong>{file?.name || '选择训练结果文件'}</strong>
              <span>XLSX、CSV直接解析；图片和PDF使用AI识别，最大12MB</span>
            </label>
            <div className="strength-import-guidance">
              <strong>建议字段</strong>
              <span>训练日期、运动员、训练类型、身体位置、训练环境、动作、计划/实际次数与重量、强度、时间、距离、RPE</span>
            </div>
            {message && <div className="strength-inline-message error"><AlertTriangle size={16} />{message}</div>}
            <footer>
              <button type="button" className="strength-button ghost" onClick={() => api.downloadStrengthResultTemplate()}><Download size={16} />下载Excel模板</button>
              <button type="button" className="strength-button primary" disabled={!file || busy === 'preview'} onClick={analyze}>
                {busy === 'preview' ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}识别并校对
              </button>
            </footer>
          </div>
        ) : (
          <div className="strength-import-review">
            <div className="strength-import-summary">
              <div><span>识别行数</span><strong>{rows.length}</strong></div>
              <div><span>需要修正</span><strong className={summary.invalid ? 'danger' : ''}>{summary.invalid}</strong></div>
              <div><span>疑似重复</span><strong>{summary.duplicate}</strong></div>
              <div><span>低置信度</span><strong>{summary.lowConfidence}</strong></div>
              <small>{preview.modelUsed}</small>
            </div>

            <div className="strength-import-table-wrap">
              <table className="strength-import-table">
                <thead><tr><th>状态</th><th>日期</th><th>运动员</th><th>训练类型</th><th>位置</th><th>环境</th><th>场次</th><th>动作</th><th>组次</th><th>计划次数</th><th>实际次数</th><th>计划kg</th><th>实际kg</th><th>强度%</th><th>区间</th><th>时间min</th><th>距离km</th><th>RPE</th><th>备注</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.rowNumber}-${index}`} className={row.errors.length ? 'invalid' : row.duplicate ? 'duplicate' : ''}>
                    <td className="import-row-state" title={[...row.errors, ...row.warnings].join('；')}>
                      {row.errors.length ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                      <small>{row.confidence === null ? '结构化' : `${Math.round(row.confidence * 100)}%`}</small>
                    </td>
                    <td><input type="date" value={row.trainingDate} onChange={(event) => updateRow(index, { trainingDate: event.target.value })} /></td>
                    <td><select value={row.athleteId || ''} onChange={(event) => {
                      const athlete = athletes.find((item) => item.id === Number(event.target.value));
                      updateRow(index, { athleteId: athlete?.id || null, athleteName: athlete?.name || '', matchedAthleteName: athlete?.name || '', team: athlete?.team || '' });
                    }}><option value="">请选择</option>{athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name} · {athlete.team}</option>)}</select></td>
                    <td><select value={row.trainingCategory} onChange={(event) => updateRow(index, { trainingCategory: event.target.value as StrengthTrainingCategory })}>{STRENGTH_TRAINING_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></td>
                    <td><select value={row.bodyPosition} onChange={(event) => updateRow(index, { bodyPosition: event.target.value as StrengthBodyPosition })}>{STRENGTH_BODY_POSITIONS.map((value) => <option key={value}>{value}</option>)}</select></td>
                    <td><select value={row.trainingEnvironment} onChange={(event) => updateRow(index, { trainingEnvironment: event.target.value as StrengthTrainingEnvironment })}>{STRENGTH_TRAINING_ENVIRONMENTS.map((value) => <option key={value}>{value}</option>)}</select></td>
                    <td><input value={row.sessionLabel} onChange={(event) => updateRow(index, { sessionLabel: event.target.value })} /></td>
                    <td><input value={row.exerciseName} onChange={(event) => updateRow(index, { exerciseName: event.target.value })} /></td>
                    <td><input type="number" min="1" value={row.setIndex} onChange={(event) => updateRow(index, { setIndex: Math.max(1, Number(event.target.value) || 1) })} /></td>
                    <td><input type="number" min="0" value={row.targetReps ?? ''} onChange={(event) => updateRow(index, { targetReps: nullableNumber(event.target.value) })} /></td>
                    <td><input type="number" min="0" value={row.actualReps ?? ''} onChange={(event) => updateRow(index, { actualReps: nullableNumber(event.target.value) })} /></td>
                    <td><input type="number" min="0" step="0.1" value={row.plannedWeightKg ?? ''} onChange={(event) => updateRow(index, { plannedWeightKg: nullableNumber(event.target.value) })} /></td>
                    <td><input type="number" min="0" step="0.1" value={row.actualWeightKg ?? ''} onChange={(event) => updateRow(index, { actualWeightKg: nullableNumber(event.target.value) })} /></td>
                    <td><input type="number" min="0" max="100" step="0.1" value={row.intensityPercent ?? ''} onChange={(event) => updateRow(index, { intensityPercent: nullableNumber(event.target.value) })} /></td>
                    <td><select value={row.intensityZone} onChange={(event) => updateRow(index, { intensityZone: event.target.value as StrengthIntensityZone })}>{STRENGTH_INTENSITY_ZONES.map((value) => <option key={value}>{value}</option>)}</select></td>
                    <td><input type="number" min="0" step="0.1" value={row.durationMin} onChange={(event) => updateRow(index, { durationMin: Number(event.target.value) || 0 })} /></td>
                    <td><input type="number" min="0" step="0.1" value={row.distanceKm} onChange={(event) => updateRow(index, { distanceKm: Number(event.target.value) || 0 })} /></td>
                    <td><input type="number" min="0" max="10" step="0.5" value={row.rpe ?? ''} onChange={(event) => updateRow(index, { rpe: nullableNumber(event.target.value) })} /></td>
                    <td><input value={row.note} onChange={(event) => updateRow(index, { note: event.target.value })} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>

            {summary.duplicate > 0 && <fieldset className="strength-conflict-policy"><legend>遇到重复记录</legend>
              <label><input type="radio" checked={policy === 'skip'} onChange={() => setPolicy('skip')} />跳过已有记录</label>
              <label><input type="radio" checked={policy === 'update'} onChange={() => setPolicy('update')} />更新已有记录</label>
              <label><input type="radio" checked={policy === 'new'} onChange={() => setPolicy('new')} />作为另一场训练</label>
            </fieldset>}
            {message && <div className={`strength-inline-message ${message.includes('已保存') ? 'success' : 'error'}`}>{message.includes('已保存') ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{message}</div>}
            <footer>
              <button type="button" className="strength-button ghost" onClick={() => { setPreview(null); setRows([]); setMessage(''); }}>重新选择</button>
              <button type="button" className="strength-button primary" disabled={!rows.length || busy === 'commit'} onClick={commit}>
                {busy === 'commit' ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}确认保存结果
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
