"use client";

import { useEffect, useState } from "react";
import styles from "./comments.module.css";

export default function SettingsPanel() {
  const [autoReply, setAutoReply] = useState(false);
  const [delay, setDelay] = useState(60);
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/tiktok-business/settings");
        const result = await response.json();

        if (result.success) {
          setAutoReply(result.settings.auto_reply_enabled);
          setDelay(result.settings.reply_delay_seconds);
          setInstructions(result.settings.ai_instructions);
        }
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  async function saveSettings() {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/tiktok-business/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auto_reply_enabled: autoReply,
          reply_delay_seconds: delay,
          ai_instructions: instructions,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setMessage("Settings saved successfully.");
      } else {
        setMessage("Failed to save settings.");
      }
    } catch {
      setMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className={styles.settingsPanel}>
        Loading settings...
      </section>
    );
  }

  return (
    <section className={styles.settingsPanel}>
      <div className={styles.settingsHeader}>
        <div>
          <h2>AI Settings</h2>
          <p>Control how Ticalbak replies to TikTok comments.</p>
        </div>

        <label className={styles.toggleRow}>
          <span>Auto Reply</span>

          <input
            type="checkbox"
            checked={autoReply}
            onChange={(e) => setAutoReply(e.target.checked)}
          />

          <strong>{autoReply ? "ON" : "OFF"}</strong>
        </label>
      </div>

      <div className={styles.settingsGrid}>
        <div>
          <label className={styles.label}>
            Reply delay
          </label>

          <div className={styles.delayRow}>
            <input
              className={styles.numberInput}
              type="number"
              min="30"
              value={delay}
              onChange={(e) => setDelay(Number(e.target.value))}
            />

            <span>seconds</span>
          </div>
        </div>

        <div className={styles.instructionsBox}>
          <label className={styles.label}>
            AI sales instructions
          </label>

          <textarea
            className={styles.textarea}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
          />

          <p className={styles.helpText}>
            These instructions control the sales style and tone of the replies.
          </p>
        </div>
      </div>

      <div className={styles.settingsFooter}>
        <button
          className={styles.saveButton}
          onClick={saveSettings}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>

        {message && (
          <span className={styles.saveMessage}>
            {message}
          </span>
        )}
      </div>
    </section>
  );
}
