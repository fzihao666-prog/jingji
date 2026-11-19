import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import './TestTemplatePanel.css';

export function TemplatePreviewDialog({ title, busy, onClose, preview, children }: {
  title: string;
  busy: boolean;
  onClose: () => void;
  preview?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    heading.current?.focus();
    return () => modal?.close();
  }, []);

  return (
    <dialog ref={dialog} className="template-preview-dialog" aria-labelledby={titleId} onCancel={event => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
      <header className="template-preview-heading">
        <h2 ref={heading} tabIndex={-1} id={titleId}>{title}</h2>
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>关闭预览</button>
      </header>
      {preview && <div className="template-preview-pinned">{preview}</div>}
      <div className="template-preview-body test-template-panel">{children}</div>
    </dialog>
  );
}

export function TemplatePreviewColumns({ headers, fixedColumns = headers.length, onRemove, busy }: {
  headers: readonly string[];
  fixedColumns?: number;
  onRemove?: (index: number) => void;
  busy?: boolean;
}) {
  const captionId = useId();
  const region = useRef<HTMLDivElement>(null);
  return (
    <div ref={region} className="template-preview-sheet" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table>
        <caption id={captionId}>Excel 列预览</caption>
        <thead><tr>{headers.map((header, index) => <th key={header} scope="col">
          <div className="template-preview-column">
            <span>{header}</span>
            {onRemove && index >= fixedColumns && (
              <button type="button" className="secondary-button template-preview-remove" disabled={busy}
                aria-label={`删除列：${header}`} onClick={() => {
                  region.current?.focus({ preventScroll: true });
                  onRemove(index - fixedColumns);
                }}><X size={16} aria-hidden /></button>
            )}
          </div>
        </th>)}</tr></thead>
      </table>
    </div>
  );
}
