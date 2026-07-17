export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="64" height="64" rx="16" className="fill-primary" />
      <path
        d="M32 10L15 16.5V29C15 40.5 22 49.5 32 53C42 49.5 49 40.5 49 29V16.5L32 10Z"
        className="fill-primary-fixed"
      />
      <path
        d="M32 10L15 16.5V29C15 40.5 22 49.5 32 53V10Z"
        fill="#FFFFFF"
        fillOpacity="0.35"
      />
      <path
        d="M23.5 31.5L29 37L41 24"
        stroke="#3525CD"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({
  className = "",
  wordmarkClassName = "text-headline-md",
  onDark = false,
}: {
  className?: string;
  wordmarkClassName?: string;
  onDark?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-8 w-8 shrink-0" />
      <span
        className={`font-headline font-bold ${wordmarkClassName} ${
          onDark ? "text-on-primary" : "text-on-surface"
        }`}
      >
        Delivera
      </span>
    </span>
  );
}
