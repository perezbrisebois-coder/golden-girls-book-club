import { useMemo, useState, type FormEvent } from "react";
import { collection, limit, orderBy, query, type Timestamp } from "firebase/firestore";
import { firestore } from "../firebase";
import { useCollection } from "../hooks";
import { useSession } from "../session";
import { api, friendlyError } from "../api";
import { useConfirm, useToast } from "../components/Feedback";
import { DecoDivider } from "../components/Deco";
import type { Comment } from "../types";

const commentsQuery = query(collection(firestore, "comments"), orderBy("createdAt", "desc"), limit(300));
const MAX_LENGTH = 2000;

/** "Today at 3:15 PM", "Yesterday at 9:02 AM", or "Mon, Oct 27 at 7:40 PM". */
function when(ts?: Timestamp | null): string {
  if (!ts) return "just now";
  const d = ts.toDate();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (day === todayStart) return `Today at ${time}`;
  if (day === todayStart - 86_400_000) return `Yesterday at ${time}`;
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return `${d.toLocaleDateString("en-US", opts)} at ${time}`;
}

export function CommentsPage() {
  const { data: all, loading } = useCollection<Comment>(commentsQuery, "comments");

  const { topLevel, replies } = useMemo(() => {
    const replies = new Map<string, Comment[]>();
    const topLevel: Comment[] = [];
    for (const c of all) {
      if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
      else topLevel.push(c);
    }
    // Replies read oldest-first under their comment.
    for (const list of replies.values()) list.reverse();
    // Pinned first, then newest first (the query is already newest first).
    topLevel.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return { topLevel, replies };
  }, [all]);

  return (
    <section>
      <h1 className="page-title">Comments</h1>
      <DecoDivider />

      <Composer />

      {loading ? (
        <p className="loading">Loading…</p>
      ) : topLevel.length === 0 ? (
        <div className="card">
          <p>No comments yet. Start the conversation!</p>
        </div>
      ) : (
        <ul className="comment-list">
          {topLevel.map((c) => (
            <li key={c.id}>
              <CommentItem comment={c} replies={replies.get(c.id) ?? []} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Composer({ parentId, onDone, autoFocus }: { parentId?: string; onDone?: () => void; autoFocus?: boolean }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = parentId ? `reply-${parentId}` : "new-comment";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return setError(parentId ? "Please write your reply first." : "Please write your comment first.");
    setBusy(true);
    setError("");
    try {
      await api.postComment({ text, ...(parentId ? { parentId } : {}) });
      setText("");
      toast(parentId ? "Your reply is posted!" : "Your comment is posted!");
      onDone?.();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={parentId ? "reply-form" : "card composer"} onSubmit={submit} noValidate>
      <label htmlFor={id} className={parentId ? "visually-hidden" : "label flush-top"}>
        {parentId ? "Your reply" : "Share a thought with the club"}
      </label>
      <textarea
        id={id}
        className="input"
        rows={parentId ? 2 : 3}
        maxLength={MAX_LENGTH}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={parentId ? "Write a reply…" : "What did you think? Any news for the club?"}
        autoFocus={autoFocus}
        aria-invalid={!!error}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row tight">
        <button type="submit" className={`btn btn-primary${parentId ? " btn-small" : ""}`} disabled={busy}>
          {busy ? "Posting…" : parentId ? "Post reply" : "Post comment"}
        </button>
        {onDone && (
          <button type="button" className="btn btn-secondary btn-small" onClick={onDone} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function CommentItem({ comment, replies }: { comment: Comment; replies: Comment[] }) {
  const [replying, setReplying] = useState(false);
  return (
    <article className={`card comment${comment.pinned ? " is-pinned" : ""}`}>
      {comment.pinned && <p className="pinned-label">📌 Pinned</p>}
      <CommentBody comment={comment} onReply={() => setReplying(true)} replyCount={replies.length} />
      {(replies.length > 0 || replying) && (
        <ul className="reply-list">
          {replies.map((r) => (
            <li key={r.id}>
              <CommentBody comment={r} />
            </li>
          ))}
          {replying && (
            <li>
              <Composer parentId={comment.id} onDone={() => setReplying(false)} autoFocus />
            </li>
          )}
        </ul>
      )}
    </article>
  );
}

function CommentBody({ comment, onReply, replyCount = 0 }: { comment: Comment; onReply?: () => void; replyCount?: number }) {
  const { memberId, isAdmin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.text);
  const [busy, setBusy] = useState(false);
  const mine = comment.authorId === memberId;
  const isReply = !!comment.parentId;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.editComment({ id: comment.id, text });
      setEditing(false);
      toast("Your changes are saved.");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const what = isReply ? "reply" : "comment";
    const ok = await confirm({
      title: mine ? `Delete your ${what}?` : `Delete ${comment.authorName}'s ${what}?`,
      message:
        replyCount > 0
          ? `Its ${replyCount} ${replyCount === 1 ? "reply" : "replies"} will be deleted too. This can't be undone.`
          : "This can't be undone.",
      confirmLabel: `Yes, delete it`,
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteComment({ id: comment.id });
      toast(`The ${what} was deleted.`);
    } catch (err) {
      toast(friendlyError(err), "error");
    }
  }

  async function togglePin() {
    try {
      await api.pinComment({ id: comment.id, pinned: !comment.pinned });
      toast(comment.pinned ? "Unpinned." : "Pinned to the top.");
    } catch (err) {
      toast(friendlyError(err), "error");
    }
  }

  return (
    <div className="comment-body">
      <p className="comment-meta">
        <strong className="comment-author">{comment.authorName}</strong>
        <span className="muted">
          {" "}
          · {when(comment.createdAt)}
          {comment.editedAt && " · edited"}
        </span>
      </p>
      {editing ? (
        <form onSubmit={save}>
          <label htmlFor={`edit-${comment.id}`} className="visually-hidden">
            Edit your comment
          </label>
          <textarea
            id={`edit-${comment.id}`}
            className="input"
            rows={3}
            maxLength={MAX_LENGTH}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <div className="button-row tight">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy || !text.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                setText(comment.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="comment-text">{comment.text}</p>
      )}
      {!editing && (
        <div className="comment-actions">
          {onReply && (
            <button type="button" className="btn btn-secondary btn-small" onClick={onReply}>
              Reply
            </button>
          )}
          {mine && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {(mine || isAdmin) && (
            <button type="button" className="btn btn-danger-outline btn-small" onClick={remove}>
              Delete
            </button>
          )}
          {isAdmin && !isReply && (
            <button type="button" className="btn btn-secondary btn-small" onClick={togglePin}>
              {comment.pinned ? "Unpin" : "Pin to top"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
