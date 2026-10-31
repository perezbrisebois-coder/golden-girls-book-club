import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

// These values identify the Firebase project; they are not secrets.
const firebaseConfig = {
  apiKey: "AIzaSyC1G-jj2kuK4tMdCqX4fxInxZI3fFABkds",
  authDomain: "golden-girls-book-club.firebaseapp.com",
  projectId: "golden-girls-book-club",
  storageBucket: "golden-girls-book-club.firebasestorage.app",
  messagingSenderId: "889436384901",
  appId: "1:889436384901:web:283eb330cb9eda11db03ec",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const functions = getFunctions(app, "us-central1");

export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

if (usingEmulators) {
  const host = window.location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
}
