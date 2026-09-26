import { supabaseAdmin } from "@/lib/supabaseAdmin";
import styles from "./comments.module.css";
import SettingsPanel from "./SettingsPanel";

export const dynamic = "force-dynamic";

export default async function CommentsPage() {
  const { data: comments, error } = await supabaseAdmin
    .from("tiktok_ai_comments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = comments ?? [];

  const replied = rows.filter((c) => c.status === "replied").length;
  const ready = rows.filter((c) => c.status === "ready").length;
  const pending = rows.filter(
    (c) => c.status === "pending" || c.status === "generating"
  ).length;
  const failed = rows.filter((c) => c.status === "failed").length;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>TICALBAK</p>
            <h1>TikTok Comment AI</h1>
            <p className={styles.subtitle}>
              Monitor customer comments and AI-generated replies.
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            System dashboard
          </div>
        </div>

        <section className={styles.stats}>
          <div className={styles.card}>
            <span>Total comments</span>
            <strong>{rows.length}</strong>
          </div>

          <div className={styles.card}>
            <span>Pending</span>
            <strong>{pending}</strong>
          </div>

          <div className={styles.card}>
            <span>Ready</span>
            <strong>{ready}</strong>
          </div>

          <div className={styles.card}>
            <span>Replied</span>
            <strong>{replied}</strong>
          </div>

          <div className={styles.card}>
            <span>Failed</span>
            <strong>{failed}</strong>
          </div>
        </section>

        <SettingsPanel />

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Comments</h2>
              <p>Latest 100 TikTok comments</p>
            </div>
          </div>

          {error ? (
            <div className={styles.error}>
              Failed to load comments.
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.empty}>
              No comments have been received yet.
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Comment</th>
                    <th>AI Reply</th>
                    <th>Status</th>
                    <th>Received</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((comment) => (
                    <tr key={comment.id}>
                      <td>
                        <strong>
                          @{comment.author_username || "unknown"}
                        </strong>
                      </td>

                      <td className={styles.commentText}>
                        {comment.comment_text}
                      </td>

                      <td className={styles.replyText}>
                        {comment.ai_reply_text || "—"}
                      </td>

                      <td>
                        <span
                          className={`${styles.badge} ${
                            styles[
                              `status_${comment.status}` as keyof typeof styles
                            ] || ""
                          }`}
                        >
                          {comment.status}
                        </span>
                      </td>

                      <td className={styles.time}>
                        {comment.received_at
                          ? new Date(comment.received_at).toLocaleString("it-IT")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
