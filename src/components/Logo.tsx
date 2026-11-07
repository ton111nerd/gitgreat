import Link from "next/link";

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id="lm-body" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#b9c4ff" />
          <stop offset="1" stopColor="#2a2f6b" />
        </radialGradient>
        <clipPath id="lm-front">
          <rect x="0" y="16" width="32" height="16" />
        </clipPath>
      </defs>
      <ellipse cx="16" cy="16" rx="14.5" ry="5" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2" transform="rotate(-24 16 16)" />
      <circle cx="16" cy="16" r="7.5" fill="url(#lm-body)" />
      <ellipse cx="16" cy="16" rx="14.5" ry="5" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" transform="rotate(-24 16 16)" clipPath="url(#lm-front)" />
      <circle cx="26.5" cy="6" r="1.3" fill="#fff" />
    </svg>
  );
}

export default function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="logo" aria-label="GitHub Universe – Startseite">
      <LogoMark />
      {!compact && <span className="logo-text">GitHub Universe</span>}
    </Link>
  );
}
