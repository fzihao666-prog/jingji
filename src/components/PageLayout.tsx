import type { ComponentPropsWithoutRef, ReactNode } from 'react';

type ClassNameProps = { className?: string; children?: ReactNode };

export function PageContainer({ className = '', children, ...props }: ClassNameProps & ComponentPropsWithoutRef<'main'>) {
  return <main {...props} className={`page-content ${className}`.trim()}>{children}</main>;
}

type PageHeaderProps = ClassNameProps & {
  title: ReactNode;
  eyebrow: ReactNode;
  supportingContent?: ReactNode;
  actions?: ReactNode;
  variant?: 'default' | 'compact' | 'dashboard';
};

export function PageHeader({ title, eyebrow, supportingContent, actions, variant = 'default', className = '', children }: PageHeaderProps) {
  return (
    <header className={`page-heading app-page-header app-page-header-${variant} ${className}`.trim()}>
      <div className="app-page-header-copy">
        <span className="app-page-header-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {supportingContent}
      </div>
      {(actions || children) && <div className="app-page-header-actions">{actions}{children}</div>}
    </header>
  );
}

type AppCardProps = ClassNameProps & { variant?: 'default' | 'chart' | 'compact' };

export function AppCard({ variant = 'default', className = '', children }: AppCardProps) {
  return <section className={`panel app-card app-card-${variant} ${className}`.trim()}>{children}</section>;
}

type SectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function SectionHeader({ title, description, icon, actions, className = '' }: SectionHeaderProps) {
  return (
    <header className={`panel-heading app-section-header ${className}`.trim()}>
      <div>{icon && <span className="app-section-header-icon">{icon}</span>}<h2>{title}</h2></div>
      {(description || actions) && <div className="app-section-header-meta">{description && <small>{description}</small>}{actions}</div>}
    </header>
  );
}

type FilterBarProps = ClassNameProps & { label?: string; actions?: ReactNode };

export function FilterBar({ label = '筛选条件', actions, className = '', children }: FilterBarProps) {
  return <section className={`app-filter-bar ${className}`.trim()} aria-label={label}>{children}{actions && <div className="app-filter-bar-actions">{actions}</div>}</section>;
}

type ContentStateProps = { kind: 'loading' | 'empty' | 'error'; title: string; description?: string; icon?: ReactNode; className?: string; action?: ReactNode };

export function ContentState({ kind, title, description, icon, className = '', action }: ContentStateProps) {
  return <section className={`app-content-state app-content-state-${kind} ${className}`.trim()} role={kind === 'error' ? 'alert' : undefined}>
    {icon}<strong>{title}</strong>{description && <span>{description}</span>}{action}
  </section>;
}

type ChartCardProps = AppCardProps & { title: ReactNode; description?: ReactNode; actions?: ReactNode };

export function ChartCard({ title, description, actions, children, className = '', variant = 'chart' }: ChartCardProps) {
  return <AppCard variant={variant} className={`app-chart-card ${className}`}><SectionHeader title={title} description={description} actions={actions}/>{children}</AppCard>;
}
