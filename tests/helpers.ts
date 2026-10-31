import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

export const PROJECT = "demo-golden-girls";
const apps: FirebaseApp[] = [];
let n = 0;

/** A fresh browser-like client: its own anonymous session. */
export async function newClient() {
  const app = initializeApp({ projectId: PROJECT, apiKey: "fake-key" }, `client-${++n}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });
  const fns = getFunctions(app, "us-central1");
  connectFunctionsEmulator(fns, "127.0.0.1", 5101);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8180);
  await signInAnonymously(auth);

  const call = async <T = any>(name: string, data: unknown = {}): Promise<T> =>
    (await httpsCallable(fns, name)(data)).data as T;
  const refresh = () => auth.currentUser!.getIdToken(true);
  const claims = async () => (await auth.currentUser!.getIdTokenResult()).claims;

  /** Enter a password + identify, the way the website does. */
  const join = async (password: string, name: string, pin = "1234") => {
    await call("enterPassword", { password });
    await refresh();
    const res = await call("identifyMember", { name, pin, createIfNew: true });
    await refresh();
    return res;
  };
  return { app, auth, db, call, refresh, claims, join };
}

export async function cleanupClients() {
  await Promise.all(apps.splice(0).map((a) => deleteApp(a)));
}

export async function clearData() {
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
}

/** Expects a callable to fail with the given Firebase code (e.g. "permission-denied"). */
export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const got = (e as { code?: string }).code;
    if (got !== `functions/${code}`) throw new Error(`Expected functions/${code} but got ${got}: ${(e as Error).message}`);
    return;
  }
  throw new Error(`Expected functions/${code} but the call succeeded`);
}
