import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// ---------- Toasts: friendly confirmations like "Your vote is in!" ----------

interface Toast {
  id: number;
  text: string;
  kind: "success" | "error";
}

const ToastContext = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

// ---------- Confirm dialog (replaces window.confirm, larger and clearer) ----------

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: Toast["kind"] = "success") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4500);
  }, []);

  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        {pending && (
          <ConfirmDialog
            {...pending}
            onClose={(ok) => {
              pending.resolve(ok);
              setPending(null);
            }}
          />
        )}
        <div className="toasts" aria-live="polite" role="status">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <span aria-hidden="true">{t.kind === "success" ? "✦" : "!"}</span> {t.text}
              <button
                type="button"
                className="toast-close"
                onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              >
                Close
              </button>
            </div>
          ))}
        </div>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = "Yes, continue",
  danger,
  onClose,
}: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onCancel={() => onClose(false)} aria-labelledby="confirm-title">
      <h2 id="confirm-title">{title}</h2>
      {message && <p>{message}</p>}
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={() => onClose(false)} autoFocus>
          No, go back
        </button>
        <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={() => onClose(true)}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
