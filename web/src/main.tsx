import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { SessionProvider } from "./session";
import { FeedbackProvider } from "./components/Feedback";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </SessionProvider>
  </StrictMode>,
);
