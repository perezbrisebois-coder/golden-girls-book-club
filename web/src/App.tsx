import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./session";
import { Layout } from "./components/Layout";
import { PasswordPage } from "./pages/PasswordPage";
import { WhoAreYouPage } from "./pages/WhoAreYouPage";
import { MeetingPage } from "./pages/MeetingPage";
import { ComingSoon } from "./pages/ComingSoon";
import { VotePage } from "./pages/VotePage";
import { DatesPage } from "./pages/DatesPage";
import { SuggestPage } from "./pages/SuggestPage";

export default function App() {
  const { ready, role, memberId, isAdmin } = useSession();

  if (!ready) return <p className="loading center">Loading…</p>;
  if (!role) return <PasswordPage />;
  if (!memberId) return <WhoAreYouPage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MeetingPage />} />
          <Route path="dates" element={<DatesPage />} />
          <Route path="suggest" element={<SuggestPage />} />
          <Route path="vote" element={<VotePage />} />
          <Route path="comments" element={<ComingSoon title="Comments" />} />
          {isAdmin && <Route path="members" element={<ComingSoon title="Manage Members" />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
