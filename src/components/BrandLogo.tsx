type BrandLogoProps = {
  className?: string;
  variant?: 'mark' | 'full';
};

export function BrandLogo({ className = '', variant = 'mark' }: BrandLogoProps) {
  const source = variant === 'full' ? '/assets/gfc-logo.png' : '/assets/gfc-mark.png';
  return (
    <img
      className={`brand-logo brand-logo-${variant} ${className}`.trim()}
      src={source}
      alt=""
      aria-hidden="true"
    />
  );
}
