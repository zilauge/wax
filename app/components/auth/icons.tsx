const iconProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

type IconProps = { className?: string };

export function MailIcon({ className }: IconProps) {
  return (
    <svg {...iconProps} className={className} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.8 7 7.4 5.3a1.5 1.5 0 0 0 1.6 0L20.2 7" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...iconProps} className={className} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <svg {...iconProps} className={className} aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c.9-3.1 3.6-5 7-5s6.1 1.9 7 5" />
    </svg>
  );
}

export function EyeIcon({
  className,
  off = false,
}: IconProps & { off?: boolean }) {
  return (
    <svg {...iconProps} className={className} aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg {...iconProps} className={className} aria-hidden="true">
      <path d="M5 12h14M13.5 6.5 19.5 12l-6 5.5" />
    </svg>
  );
}

export function SparklesIcon({ className }: IconProps) {
  return (
    <svg {...iconProps} className={className} aria-hidden="true">
      <path d="M12 4.5 13.6 9l4.4 1.6L13.6 12 12 16.5 10.4 12 6 10.6 10.4 9 12 4.5Z" />
      <path d="M18 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
    </svg>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...iconProps} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.3 2.4 2.4 4.6-5" />
    </svg>
  );
}
