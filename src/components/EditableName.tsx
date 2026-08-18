import { Check, PencilLine, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  value: string;
  canEdit?: boolean;
  onSave: (name: string) => Promise<void>;
  label?: string;
  className?: string;
  showValue?: boolean;
};

export function EditableName({
  value,
  canEdit = false,
  onSave,
  label = '姓名',
  className = '',
  showValue = true
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) setName(value);
  }, [value, open]);

  const close = () => {
    if (saving) return;
    setOpen(false);
    setError('');
    setName(value);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (nextName === value) {
      close();
      return;
    }
    if (nextName.length < 2 || nextName.length > 20) {
      setError('姓名须为2—20个字符。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(nextName);
      setOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '姓名修改失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <span className={`editable-name ${className}`.trim()}>
        {showValue && <span className="editable-name-value">{value}</span>}
        {canEdit && (
          <button
            type="button"
            className="name-edit-trigger"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setName(value);
              setError('');
              setOpen(true);
            }}
            aria-label={`修改${value}的姓名`}
            title="修改姓名"
          >
            <PencilLine size={13} />
          </button>
        )}
      </span>
      {open && createPortal(
        <div className="modal-backdrop name-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="name-editor-modal" role="dialog" aria-modal="true" aria-labelledby="name-editor-title">
            <div className="modal-heading">
              <div><span>资料修改</span><h2 id="name-editor-title">修改{label}</h2></div>
              <button className="icon-button" type="button" onClick={close} aria-label="关闭"><X size={19} /></button>
            </div>
            <form onSubmit={submit}>
              <label>
                <span>新姓名</span>
                <input
                  autoFocus
                  value={name}
                  maxLength={20}
                  onChange={(event) => setName(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  required
                />
              </label>
              {error && <p className="name-editor-error">{error}</p>}
              <div className="name-editor-actions">
                <button type="button" className="secondary-button" onClick={close}>取消</button>
                <button className="primary-button" disabled={saving}><Check size={16} />{saving ? '保存中…' : '保存姓名'}</button>
              </div>
            </form>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
