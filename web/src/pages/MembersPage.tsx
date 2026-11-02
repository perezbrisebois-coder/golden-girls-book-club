import { collection, orderBy, query } from "firebase/firestore";
import { firestore } from "../firebase";
import { useCollection } from "../hooks";
import { useSession } from "../session";
import { api, friendlyError } from "../api";
import { useConfirm, useToast } from "../components/Feedback";
import { DecoDivider } from "../components/Deco";
import type { Member } from "../types";

const membersQuery = query(collection(firestore, "members"), orderBy("nameKey"));

/** Admin only: see everyone, clear a forgotten PIN, or remove a member. */
export function MembersPage() {
  const { memberId } = useSession();
  const { data: members, loading } = useCollection<Member>(membersQuery, "members");
  const toast = useToast();
  const confirm = useConfirm();

  async function clearPin(m: Member) {
    const ok = await confirm({
      title: `Clear ${m.name}'s PIN?`,
      message: `Do this if ${m.name} forgot their PIN. Next time they sign in with their name, they'll choose a new PIN. Everything they've posted stays linked to them.`,
      confirmLabel: "Yes, clear the PIN",
    });
    if (!ok) return;
    try {
      await api.adminClearPin({ memberId: m.id });
      toast(`${m.name}'s PIN is cleared. They'll choose a new one next time.`);
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  async function remove(m: Member) {
    const ok = await confirm({
      title: `Remove ${m.name} from the club?`,
      message: `Their profile, PIN, date-poll answers and any vote in an open ballot are deleted. Their suggestions and comments stay, under their name. If they come back, they can sign in again as a new member. This can't be undone.`,
      confirmLabel: `Remove ${m.name}`,
      danger: true,
    });
    if (!ok) return;
    try {
      await api.adminRemoveMember({ memberId: m.id });
      toast(`${m.name} was removed.`);
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  return (
    <section>
      <h1 className="page-title">Manage Members</h1>
      <DecoDivider />
      <div className="card">
        <p>
          Members join on their own: they enter the club password, then their name and a 4-digit PIN they choose. You
          never see anyone's PIN.
        </p>
        <p className="hint">
          Forgot their PIN? Use <strong>Clear PIN</strong> and they'll choose a new one next time they sign in.
        </p>
      </div>

      {loading ? (
        <p className="loading">Loading…</p>
      ) : (
        <>
          <h2 className="section-title">
            {members.length} {members.length === 1 ? "member" : "members"}
          </h2>
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.id} className="card member-item">
                <div className="member-info">
                  <p className="member-name">
                    {m.name}
                    {m.id === memberId && <span className="badge">You</span>}
                  </p>
                  <p className={m.hasPin ? "muted" : "pin-cleared"}>
                    {m.hasPin ? "PIN set" : "PIN cleared: they'll choose a new one when they next sign in"}
                    {m.createdAt && ` · joined ${m.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                  </p>
                </div>
                {m.id !== memberId && (
                  <div className="button-row tight">
                    {m.hasPin && (
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => clearPin(m)}>
                        Clear PIN
                      </button>
                    )}
                    <button type="button" className="btn btn-danger-outline btn-small" onClick={() => remove(m)}>
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
