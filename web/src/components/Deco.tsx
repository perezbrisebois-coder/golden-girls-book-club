/** Original Art Deco ornaments (no show imagery). Purely decorative. */

export function DecoDivider() {
  return (
    <svg className="deco-divider" viewBox="0 0 400 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <line x1="0" y1="12" x2="160" y2="12" stroke="currentColor" strokeWidth="1.5" />
      <line x1="240" y1="12" x2="400" y2="12" stroke="currentColor" strokeWidth="1.5" />
      <line x1="40" y1="7" x2="160" y2="7" stroke="currentColor" strokeWidth="0.75" />
      <line x1="240" y1="17" x2="360" y2="17" stroke="currentColor" strokeWidth="0.75" />
      <path d="M200 2 L212 12 L200 22 L188 12 Z" fill="currentColor" />
      <path d="M176 12 L184 6 L184 18 Z M224 12 L216 6 L216 18 Z" fill="currentColor" />
    </svg>
  );
}

/** A sunburst fan used above the title. */
export function DecoFan({ size = 96 }: { size?: number }) {
  const rays = Array.from({ length: 9 }, (_, i) => -80 + i * 20);
  return (
    <svg width={size} height={size / 2} viewBox="0 0 100 50" aria-hidden="true" focusable="false" className="deco-fan">
      {rays.map((deg) => (
        <line
          key={deg}
          x1="50"
          y1="50"
          x2={50 + 46 * Math.sin((deg * Math.PI) / 180)}
          y2={50 - 46 * Math.cos((deg * Math.PI) / 180)}
          stroke="currentColor"
          strokeWidth="1.6"
        />
      ))}
      <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M30 50 A20 20 0 0 1 70 50 Z" fill="currentColor" />
    </svg>
  );
}

/** Placeholder "cover" when a book has no image. */
export function BookPlaceholder({ title }: { title: string }) {
  return (
    <div className="book-placeholder" aria-hidden="true">
      <DecoFan size={64} />
      <span>{title}</span>
    </div>
  );
}
