import { NavLink, Outlet } from "react-router-dom";
import { useSession } from "../session";
import { api, friendlyError } from "../api";
import { useConfirm, useToast } from "./Feedback";
import { DecoDivider } from "./Deco";
import { usingEmulators } from "../firebase";

const TABS = [
  { to: "/", label: "Meeting", long: "Meeting Info", icon: "◆" },
  { to: "/dates", label: "Dates", long: "Pick a Date", icon: "▦" },
  { to: "/suggest", label: "Suggest", long: "Suggest", icon: "❦" },
  { to: "/vote", label: "Vote", long: "Vote", icon: "✓" },
  { to: "/comments", label: "Comments", long: "Comments", icon: "❝" },
];

export function Layout() {
  const { member, isAdmin, refresh } = useSession();
  const toast = useToast();
  const confirm = useConfirm();

  async function notMe() {
    const ok = await confirm({
      title: `Switch person?`,
      message: `This device will forget ${member?.name}. The next person will type their own name and PIN.`,
      confirmLabel: "Yes, switch person",
    });
    if (!ok) return;
    try {
      await api.switchMember({});
      await refresh();
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  async function seed() {
    try {
      const r = await api.seedDemo({});
      toast(`Demo data loaded. Demo members: ${r.members.join(", ")} (PIN ${r.pin}).`);
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  return (
    <div className="app">
      {usingEmulators && (
        <div className="dev-banner">
          Test mode (local emulator).{" "}
          {isAdmin && (
            <button type="button" className="btn-link" onClick={seed}>
              Load demo data
            </button>
          )}
        </div>
      )}
      <header className="site-header">
        <p className="site-title">
          The Golden Girls <span>Book Club</span>
        </p>
        <div className="whoami">
          <span>
            Hello, <strong>{member?.name}</strong>
            {isAdmin && <span className="badge">Admin</span>}
          </span>
          <span className="whoami-links">
            {isAdmin && (
              <NavLink to="/members" className="btn-link">
                Manage members
              </NavLink>
            )}
            <button type="button" className="btn-link" onClick={notMe}>
              Not {member?.name}?
            </button>
          </span>
        </div>
        <nav className="tabs" aria-label="Main sections">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} className="tab">
              <span className="tab-icon" aria-hidden="true">
                {t.icon}
              </span>
              <span className="tab-label-short">{t.label}</span>
              <span className="tab-label-long">{t.long}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="site-footer">
        <DecoDivider />
        <p>A private club page for members only.</p>
      </footer>
    </div>
  );
}
