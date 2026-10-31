export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </div>
  );
}
