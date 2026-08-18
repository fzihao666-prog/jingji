import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RotateCcw, UploadCloud, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../api';
import type { ImportPreview, Project } from '../types';

export function ImportPage({ onImported, project }: { onImported: () => void; project: Project }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const chooseFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      setPreview(await api.previewImport(file, project));
    } catch (requestError) {
      setPreview(null);
      setError(requestError instanceof Error ? requestError.message : '文件读取失败。');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.commitImport(preview.importId);
      setSuccess(`已导入${result.imported}条记录${result.skipped ? `，跳过${result.skipped}条错误记录` : ''}。`);
      setPreview(null);
      onImported();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '导入失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-content import-page">
      <header className="page-heading compact-heading">
        <h1>{project} Excel数据导入</h1>
        <button className="secondary-button" onClick={() => api.downloadTemplate()}><Download size={17} /> 下载标准模板</button>
      </header>

      <section className="import-steps">
        <div className="active"><span>1</span><div><strong>上传文件</strong></div></div>
        <i />
        <div className={preview ? 'active' : ''}><span>2</span><div><strong>核对结果</strong></div></div>
        <i />
        <div className={success ? 'active' : ''}><span>3</span><div><strong>确认入库</strong></div></div>
      </section>

      {!preview && !success && (
        <section
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}
        >
          <div className="upload-illustration"><FileSpreadsheet size={34} /><div className="upload-arrow"><UploadCloud size={20} /></div></div>
          <h2>{busy ? '正在读取并校验…' : '将教练汇总的Excel拖到这里'}</h2>
          <p>支持 .xlsx，单个文件不超过12MB；每名运动员每天填写一行。专项测试请在“专项测试”模块导入。</p>
          <button className="primary-button" disabled={busy} onClick={() => inputRef.current?.click()}>选择Excel文件</button>
          <input ref={inputRef} hidden type="file" accept=".xlsx" onChange={(event) => chooseFile(event.target.files?.[0])} />
          <div className="field-hint"><span>必填：日期</span><span>运动员</span><span>总时长或分项时长</span><span>支持：水上U3—ATP逐强度距离与时间、测功仪、力量、RPE与恢复指标</span></div>
        </section>
      )}

      {error && <div className="message-banner error"><XCircle />{error}</div>}
      {success && (
        <section className="success-state"><CheckCircle2 /><h2>数据已经入库</h2><p>{success}</p><button className="secondary-button" onClick={() => setSuccess('')}><RotateCcw size={17} />继续导入</button></section>
      )}

      {preview && (
        <section className="preview-panel">
          <div className="preview-heading">
            <div><span className="file-badge"><FileSpreadsheet size={17} />{preview.fileName}</span><h2>导入预览</h2></div>
            <div className="preview-stats">
              <span><strong>{preview.total}</strong>总行数</span>
              <span className="valid"><strong>{preview.valid}</strong>可导入</span>
              <span className="invalid"><strong>{preview.invalid}</strong>错误</span>
              <span className="warning"><strong>{preview.warningCount}</strong>提醒</span>
            </div>
          </div>
          <div className="table-scroll preview-table-wrap">
            <table className="data-table preview-table">
              <thead><tr><th>行</th><th>校验</th><th>日期</th><th>运动员</th><th>训练类型</th><th>时长</th><th>RPE</th><th>SRPE</th><th>问题</th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 80).map((row) => (
                  <tr key={row.rowNumber} className={row.errors.length ? 'row-invalid' : ''}>
                    <td>{row.rowNumber}</td>
                    <td>{row.errors.length ? <XCircle className="row-error-icon" /> : row.warnings.length ? <AlertTriangle className="row-warning-icon" /> : <CheckCircle2 className="row-valid-icon" />}</td>
                    <td>{row.date || '—'}</td><td><strong>{row.athleteName || '—'}</strong></td><td>{row.trainingType}</td>
                    <td>{row.durationMin}分钟</td><td>{row.rpe ?? '—'}</td><td>{row.srpe}</td>
                    <td><span className="issue-copy">{[...row.errors, ...row.warnings].join('；') || '通过'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="preview-actions">
            <button className="secondary-button" onClick={() => setPreview(null)}>重新选择</button>
            <button className="primary-button" disabled={busy || preview.valid === 0} onClick={commit}>{busy ? '正在写入…' : `确认导入 ${preview.valid} 条`}</button>
          </div>
        </section>
      )}
    </div>
  );
}
