import { useEffect, useState } from "react";
import { onSnapshot, type DocumentReference, type Query } from "firebase/firestore";

interface State<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/** Live-subscribes to one document. `ref` must be stable (memoise or build from a key). */
export function useDoc<T>(ref: DocumentReference | null, key: string): State<T | null> {
  const [state, setState] = useState<State<T | null>>({ data: null, loading: !!ref, error: null });
  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      ref,
      (snap) => setState({ data: snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null, loading: false, error: null }),
      (error) => setState({ data: null, loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** Live-subscribes to a query. `key` should change whenever the query changes. */
export function useCollection<T>(query: Query | null, key: string): State<T[]> {
  const [state, setState] = useState<State<T[]>>({ data: [], loading: !!query, error: null });
  useEffect(() => {
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      query,
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T), loading: false, error: null }),
      (error) => setState({ data: [], loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
