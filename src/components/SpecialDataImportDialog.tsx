import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, LoaderCircle, Upload, X, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../api';
import type { Project, SpecialTestImportPreview } from '../types';
import './SpecialDataImportDialog.css';

type Props = {
  project: Project;
  onClose: () => void;
  onCommitted: () => void | Promise<void>;
};

function formatTime(milliseconds: number | null) {
  if (milliseconds === null || milliseconds <= 0) return '—';
  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

export function SpecialDataImportDialog({ project, onClose, onCommitted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SpecialTestImportPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | 'download' | ''>('');
  const [message, setMessage] = useState('');

  const summary = useMemo(() => ({
    valid: preview?.valid || 0,
    invalid: preview?.invalid || 0,
    warnings: preview?.warningCount || 0,
  }), [preview]);

  const analyze = async () => {
    if (!file) return;
    setBusy('preview');
    setMessage('');
    try {
      setPreview(await api.previewSpecialTests(file, project));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '专项数据识别失败。');
    } finally {
      setBusy('');
    }
  };

  const downloadTemplate = async () => {
    setBusy('download');
    setMessage('');
    try {
      await api.downloadSpecialTestTemplate();
      setMessage('模板已开始下载，请查看模板中的“填写说明”。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '专项数据模板下载失败。');
    } finally {
      setBusy('');
    }
  };

  const commit = async () => {
    if (!preview || preview.valid === 0) return;
    setBusy('commit');
    setMessage('');
    try {
      const result = await api.commitSpecialTests(preview.importId);
      await onCommitted();
      setMessage(`已保存 ${result.imported} 条成绩，形成 ${result.events} 个专项训练批次。`);
      window.setTimeout(onClose, 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '专项数据保存失败。');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="special-data-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="special-data-dialog" role="dialog" aria-modal="true" aria-labelledby="special-data-import-title">
        <header>
          <div>
            <span>RESULT INTAKE</span>
            <h2 id="special-data-import-title">导入{project}专项数据</h2>
            <p>先预览校验，确认后的成绩才会写入数据库并用于专项分析。</p>
          </div>
          <button type="button" className="special-data-icon-button" onClick={onClose} disabled={Boolean(busy)} aria-label="关闭导入"><X size={19} /></button>
        </header>

        {!preview ? <div className="special-data-import-start">
          <label className={`special-data-dropzone ${file ? 'has-file' : ''}`}>
            <input type="file" accept=".xlsx" onChange={(event) => { setFile(event.target.files?.[0] || null); setMessage(''); }} />
            {file ? <FileSpreadsheet size={34} /> : <Upload size={34} />}
            <strong>{file?.name || '选择专项数据文件'}</strong>
            <span>请使用系统模板填写，仅支持 XLSX 文件</span>
          </label>

          <div className="special-data-guidance">
            <strong>模板包含的主要字段</strong>
            <span>训练日期、项目、距离、艇型、性别组别、运动员或组合、训练时段、环境条件、历史最好与三轮计时成绩。</span>
          </div>

          {message && <div className={`special-data-message ${message.includes('开始下载') ? 'success' : 'error'}`}>
            {message.includes('开始下载') ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{message}
          </div>}

          <footer>
            <button type="button" className="special-data-button ghost" onClick={downloadTemplate} disabled={Boolean(busy)}>
              {busy === 'download' ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}下载Excel模板
            </button>
            <button type="button" className="special-data-button primary" disabled={!file || Boolean(busy)} onClick={analyze}>
              {busy === 'preview' ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}识别并校对
            </button>
          </footer>
        </div> : <div className="special-data-import-review">
          <div className="special-data-summary">
            <div><span>文件行数</span><strong>{preview.total}</strong></div>
            <div><span>有效数据</span><strong>{summary.valid}</strong></div>
            <div><span>需要修正</span><strong className={summary.invalid ? 'danger' : ''}>{summary.invalid}</strong></div>
            <div><span>校验提醒</span><strong>{summary.warnings}</strong></div>
            <small>{preview.fileName}</small>
          </div>

          <div className="special-data-table-wrap">
            <table className="special-data-table">
              <thead><tr><th>状态</th><th>Excel行</th><th>日期</th><th>项目 / 距离</th><th>艇型 / 组别</th><th>运动员 / 组合</th><th>各轮成绩</th><th>本次最好</th><th>校验说明</th></tr></thead>
              <tbody>{preview.rows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? 'invalid' : ''}>
                <td>{row.errors.length ? <XCircle className="row-error" size={17} /> : <CheckCircle2 className="row-ok" size={17} />}</td>
                <td>{row.rowNumber}</td>
                <td>{row.testDate || '—'}</td>
                <td><strong>{row.project || '未填写'}</strong><small>{row.distanceM ? `${row.distanceM} m` : '距离无效'}</small></td>
                <td><strong>{row.boatClass}</strong><small>{row.genderGroup}</small></td>
                <td><strong>{row.crewName || '未填写'}</strong><small>{row.memberNames.join('、') || '未匹配运动员'}</small></td>
                <td>{row.attemptsMs.length ? row.attemptsMs.map(formatTime).join(' / ') : '—'}</td>
                <td><strong>{formatTime(row.bestMs)}</strong></td>
                <td><span className={row.errors.length ? 'validation-error' : 'validation-ok'}>{row.errors.join('；') || row.warnings.join('；') || '校验通过'}</span></td>
              </tr>)}</tbody>
            </table>
          </div>

          {message && <div className={`special-data-message ${message.includes('已保存') ? 'success' : 'error'}`}>
            {message.includes('已保存') ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{message}
          </div>}

          <footer>
            <button type="button" className="special-data-button ghost" disabled={Boolean(busy)} onClick={() => { setPreview(null); setFile(null); setMessage(''); }}>重新选择</button>
            <button type="button" className="special-data-button primary" disabled={preview.valid === 0 || Boolean(busy)} onClick={commit}>
              {busy === 'commit' ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}确认保存 {preview.valid} 条有效数据
            </button>
          </footer>
        </div>}
      </section>
    </div>
  );
}
