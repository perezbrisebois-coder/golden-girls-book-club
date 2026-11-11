import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onIdTokenChanged, signInAnonymously, signOut, type User } from "firebase/auth";
import { doc } from "firebase/firestore";
import { auth, firestore } from "./firebase";
import { useDoc } from "./hooks";
import type { Member, Role } from "./types";

interface Session {
  ready: boolean;
  user: User | null;
  role: Role | null;
  isAdmin: boolean;
  memberId: string | null;
  member: Member | null;
  /** Re-reads the session after a Cloud Function changed it. */
  refresh: () => Promise<void>;
  /** Fully leave: forgets the password and the member on this device. */
  leave: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<{ role: Role | null; memberId: string | null }>({ role: null, memberId: null });
  const [authReady, setAuthReady] = useState(false);

  useEffect(
    () =>
      onIdTokenChanged(auth, async (u) => {
        if (!u) {
          setUser(null);
          setClaims({ role: null, memberId: null });
          try {
            await signInAnonymously(auth);
          } catch (e) {
            console.error("Anonymous sign-in failed", e);
            setAuthReady(true);
          }
          return;
        }
        let token;
        try {
          token = await u.getIdTokenResult();
        } catch (e) {
          // A saved session that can no longer be refreshed (e.g. deleted account):
          // start over with a fresh one instead of hanging on "Loading…".
          console.error("Saved session is no longer valid; starting a new one", e);
          await signOut(auth).catch(() => undefined);
          return;
        }
        const role = token.claims.role === "admin" || token.claims.role === "member" ? token.claims.role : null;
        const memberId = typeof token.claims.memberId === "string" ? token.claims.memberId : null;
        setUser(u);
        setClaims({ role, memberId });
        setAuthReady(true);
      }),
    [],
  );

  const memberRef = claims.role && claims.memberId ? doc(firestore, "members", claims.memberId) : null;
  const memberState = useDoc<Member>(memberRef, `${claims.role}:${claims.memberId}`);

  const refresh = useCallback(async () => {
    await auth.currentUser?.getIdToken(true);
  }, []);

  const leave = useCallback(async () => {
    await signOut(auth); // onIdTokenChanged signs in a fresh anonymous session
  }, []);

  const value = useMemo<Session>(
    () => ({
      ready: authReady && !memberState.loading,
      user,
      role: claims.role,
      isAdmin: claims.role === "admin",
      // If the member was removed by the admin, treat this device as not identified.
      memberId: memberState.data ? claims.memberId : null,
      member: memberState.data,
      refresh,
      leave,
    }),
    [authReady, memberState.loading, memberState.data, user, claims, refresh, leave],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}
