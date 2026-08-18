import type { TrainingStatus } from '../types';
import { statusMeta } from '../utils';

export function StatusPill({ status, compact = false }: { status: TrainingStatus; compact?: boolean }) {
  const meta = statusMeta[status];
  return (
    <span className={`status-pill status-${status}`}>
      <i style={{ backgroundColor: meta.color }} />
      {compact ? meta.short : meta.label}
    </span>
  );
}

