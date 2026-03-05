// ============================================================
// HTML EMAIL BUILDER
//
// Builds a styled HTML email for digest notifications.
//
// KEY CONCEPT: Inline CSS in Emails
// Unlike websites where you put CSS in a <style> tag or .css file,
// email clients (Gmail, Outlook, etc.) STRIP OUT <style> tags for
// security. So every element needs its styles written directly on
// it using the style="" attribute. This is called "inline CSS."
//
// It's ugly code, but it's the only reliable way to style emails!
//
// KEY CONCEPT: Table-Based Email Layout
// Modern websites use flexbox/grid, but email clients (especially
// Outlook) have terrible CSS support. Tables are the most reliable
// way to create email layouts. That's why you'll see <table> used
// for structure here — it's an email-specific best practice, not
// something you'd do on a website.
// ============================================================

// Stash's color palette — matches the frontend design
const COLORS = {
  background: "#FAF7F2",   // Warm cream background
  cardBg: "#FFFFFF",       // White card background
  text: "#6B5F53",         // Brown text (primary)
  textLight: "#9B8F83",    // Lighter brown (secondary text)
  accent: "#8B7355",       // Accent brown (headings, links)
  border: "#E8E0D8",       // Subtle border color
  tagBg: "#F0E8DC",        // Tag background
};

// The URL where users can open the Stash app
const FRONTEND_URL = process.env.FRONTEND_URL || "https://aesthetic-jelly-e1e2f9.netlify.app";

// ────────────────────────────────────────────────────────────
// HELPER: Relative Time ("3 days ago", "2 months ago")
//
// Converts a date into a human-readable relative time string.
// We calculate the difference in milliseconds, then convert to
// the most appropriate unit (minutes, hours, days, months, years).
// ────────────────────────────────────────────────────────────
function timeAgo(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;

  // Convert milliseconds to various units
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years} year${years === 1 ? "" : "s"} ago`;
  if (months > 0) return `${months} month${months === 1 ? "" : "s"} ago`;
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return "just now";
}

// ────────────────────────────────────────────────────────────
// HELPER: Truncate text to a max length
//
// If text is longer than maxLen, cut it and add "..." to show
// the reader that there's more content in the app.
// ────────────────────────────────────────────────────────────
function truncate(text, maxLen = 80) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen).trimEnd() + "...";
}

// ────────────────────────────────────────────────────────────
// HELPER: Escape HTML special characters
//
// KEY CONCEPT: HTML Escaping / XSS Prevention
// User-generated content (stash content, tags) could contain
// characters that HTML interprets as code: < > & " '
// If we don't escape these, they could break the email layout
// or even inject malicious code. This function converts them
// to their "entity" equivalents (&lt; &gt; etc.) so they
// display as plain text.
// ────────────────────────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ────────────────────────────────────────────────────────────
// HELPER: Format a stash type for display
//
// Capitalizes the first letter and makes types more readable.
// e.g., "note" -> "Note", "link" -> "Link"
// ────────────────────────────────────────────────────────────
function formatType(type) {
  if (!type) return "Item";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ────────────────────────────────────────────────────────────
// HELPER: Pluralize a word
//
// "1 note" vs "2 notes" — adds "s" when count != 1
// ────────────────────────────────────────────────────────────
function pluralize(count, singular, plural) {
  return count === 1 ? singular : (plural || singular + "s");
}

// ────────────────────────────────────────────────────────────
// SECTION: Today's Captures
//
// Groups captures by type and shows a summary like:
// "3 notes, 2 links, 1 task"
// Only shown if there are captures today.
// ────────────────────────────────────────────────────────────
function buildCapturesSection(captures) {
  if (!captures || captures.length === 0) return "";

  // Group captures by type and count them
  // KEY CONCEPT: reduce() — iterates over an array and "reduces"
  // it into a single value (here, an object of type->count pairs)
  const grouped = captures.reduce((acc, item) => {
    const type = item.type || "item";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  // Build a human-readable summary like "3 notes, 2 links"
  const summary = Object.entries(grouped)
    .map(([type, count]) => `${count} ${pluralize(count, formatType(type).toLowerCase())}`)
    .join(", ");

  return `
    <tr>
      <td style="padding: 0 24px 24px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.cardBg}; border-radius: 12px; border: 1px solid ${COLORS.border};">
          <tr>
            <td style="padding: 20px 24px;">
              <h2 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: ${COLORS.accent}; letter-spacing: 0.5px; text-transform: uppercase;">
                Today's Captures
              </h2>
              <p style="margin: 0 0 4px 0; font-size: 15px; color: ${COLORS.text};">
                You captured <strong>${captures.length} ${pluralize(captures.length, "item")}</strong> today: ${escapeHtml(summary)}.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

// ────────────────────────────────────────────────────────────
// SECTION: Unchecked Items
//
// Shows total incomplete items, broken down by category,
// with the 3 oldest items per category listed.
// Only shown if there are unchecked items.
// ────────────────────────────────────────────────────────────
function buildUncheckedSection(unchecked) {
  if (!unchecked || !unchecked.counts || unchecked.counts.length === 0) return "";

  // Calculate grand total of all unchecked items
  const totalCount = unchecked.counts.reduce((sum, row) => sum + parseInt(row.count, 10), 0);

  // Build category summary (e.g., "5 notes, 3 tasks, 2 links")
  const categorySummary = unchecked.counts
    .map((row) => `${row.count} ${pluralize(parseInt(row.count, 10), formatType(row.type).toLowerCase())}`)
    .join(", ");

  // Build the items list — 3 oldest per type
  // Group items by type first
  const itemsByType = {};
  if (unchecked.items) {
    for (const item of unchecked.items) {
      const type = item.type || "item";
      if (!itemsByType[type]) itemsByType[type] = [];
      itemsByType[type].push(item);
    }
  }

  // Build HTML for each type's items
  let itemsHtml = "";
  for (const [type, items] of Object.entries(itemsByType)) {
    itemsHtml += `
      <tr>
        <td style="padding: 8px 0 4px 0;">
          <p style="margin: 0; font-size: 13px; font-weight: 600; color: ${COLORS.accent}; text-transform: uppercase; letter-spacing: 0.3px;">
            ${escapeHtml(formatType(type))}
          </p>
        </td>
      </tr>
    `;
    for (const item of items) {
      // Format tags as small badges if present
      // "tags" from the DB might be a string or array depending on how it's stored
      let tagsHtml = "";
      const tags = Array.isArray(item.tags) ? item.tags : (item.tags ? [item.tags] : []);
      if (tags.length > 0) {
        tagsHtml = tags
          .map((tag) => `<span style="display: inline-block; background-color: ${COLORS.tagBg}; color: ${COLORS.textLight}; font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">${escapeHtml(tag)}</span>`)
          .join("");
      }

      itemsHtml += `
        <tr>
          <td style="padding: 4px 0 4px 12px; border-left: 2px solid ${COLORS.border};">
            <p style="margin: 0; font-size: 14px; color: ${COLORS.text}; line-height: 1.4;">
              ${escapeHtml(truncate(item.content))}${tagsHtml}
            </p>
          </td>
        </tr>
      `;
    }
  }

  return `
    <tr>
      <td style="padding: 0 24px 24px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.cardBg}; border-radius: 12px; border: 1px solid ${COLORS.border};">
          <tr>
            <td style="padding: 20px 24px;">
              <h2 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: ${COLORS.accent}; letter-spacing: 0.5px; text-transform: uppercase;">
                Unchecked Items
              </h2>
              <p style="margin: 0 0 16px 0; font-size: 15px; color: ${COLORS.text};">
                You have <strong>${totalCount} unchecked ${pluralize(totalCount, "item")}</strong>: ${escapeHtml(categorySummary)}.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${itemsHtml}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

// ────────────────────────────────────────────────────────────
// SECTION: Quick Stats
//
// Shows total stashes and how many were completed this week.
// Simple, motivational numbers.
// ────────────────────────────────────────────────────────────
function buildStatsSection(stats) {
  if (!stats) return "";

  const total = parseInt(stats.total, 10) || 0;
  const completedThisWeek = parseInt(stats.completed_this_week, 10) || 0;

  return `
    <tr>
      <td style="padding: 0 24px 24px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.cardBg}; border-radius: 12px; border: 1px solid ${COLORS.border};">
          <tr>
            <td style="padding: 20px 24px;">
              <h2 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: ${COLORS.accent}; letter-spacing: 0.5px; text-transform: uppercase;">
                Quick Stats
              </h2>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="padding: 8px 0; text-align: center;">
                    <p style="margin: 0; font-size: 28px; font-weight: 700; color: ${COLORS.accent};">${total}</p>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: ${COLORS.textLight};">Total Stashes</p>
                  </td>
                  <td width="50%" style="padding: 8px 0; text-align: center; border-left: 1px solid ${COLORS.border};">
                    <p style="margin: 0; font-size: 28px; font-weight: 700; color: ${COLORS.accent};">${completedThisWeek}</p>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: ${COLORS.textLight};">Completed This Week</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

// ────────────────────────────────────────────────────────────
// SECTION: Forgotten Items (weekly digest only)
//
// Lists the 10 oldest untouched incomplete items with their age.
// This nudges users to revisit old stashes they may have forgotten.
// ────────────────────────────────────────────────────────────
function buildForgottenSection(forgotten) {
  if (!forgotten || forgotten.length === 0) return "";

  let itemsHtml = "";
  for (const item of forgotten) {
    // Use updated_at if available, otherwise created_at
    const lastTouched = item.updated_at || item.created_at;
    const age = timeAgo(lastTouched);

    itemsHtml += `
      <tr>
        <td style="padding: 6px 0 6px 12px; border-left: 2px solid ${COLORS.border};">
          <p style="margin: 0; font-size: 14px; color: ${COLORS.text}; line-height: 1.4;">
            ${escapeHtml(truncate(item.content))}
          </p>
          <p style="margin: 2px 0 0 0; font-size: 12px; color: ${COLORS.textLight};">
            ${escapeHtml(formatType(item.type))} &middot; ${escapeHtml(age)}
          </p>
        </td>
      </tr>
    `;
  }

  return `
    <tr>
      <td style="padding: 0 24px 24px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.cardBg}; border-radius: 12px; border: 1px solid ${COLORS.border};">
          <tr>
            <td style="padding: 20px 24px;">
              <h2 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 600; color: ${COLORS.accent}; letter-spacing: 0.5px; text-transform: uppercase;">
                Forgotten Items
              </h2>
              <p style="margin: 0 0 16px 0; font-size: 13px; color: ${COLORS.textLight};">
                These have been sitting untouched the longest. Maybe it's time to revisit them?
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${itemsHtml}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

// ════════════════════════════════════════════════════════════
// MAIN EXPORT: buildDigestEmail
//
// Takes all the gathered data and assembles the full HTML email.
// Returns { subject, html } ready to pass to SendGrid.
//
// Parameters:
//   frequency - "daily" or "weekly"
//   captures  - array of today's stashes
//   unchecked - { counts: [...], items: [...] }
//   stats     - { total, completed_this_week }
//   forgotten - array of old untouched items (weekly only)
// ════════════════════════════════════════════════════════════
function buildDigestEmail({ frequency, captures, unchecked, stats, forgotten }) {
  const isWeekly = frequency === "weekly";
  const subject = isWeekly ? "Your weekly Stash digest" : "Your daily Stash digest";

  // Get today's date formatted nicely
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Build each section — empty sections return "" and won't appear
  const capturesHtml = buildCapturesSection(captures);
  const uncheckedHtml = buildUncheckedSection(unchecked);
  const statsHtml = buildStatsSection(stats);
  const forgottenHtml = isWeekly ? buildForgottenSection(forgotten) : "";

  // Check if there's any content at all
  const hasContent = capturesHtml || uncheckedHtml || statsHtml || forgottenHtml;

  // If no content at all, show a friendly "nothing to report" message
  const emptyMessage = !hasContent ? `
    <tr>
      <td style="padding: 0 24px 24px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.cardBg}; border-radius: 12px; border: 1px solid ${COLORS.border};">
          <tr>
            <td style="padding: 24px; text-align: center;">
              <p style="margin: 0; font-size: 15px; color: ${COLORS.textLight};">
                Nothing new to report today. Your stash is quiet!
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  ` : "";

  // Assemble the full HTML email
  // KEY CONCEPT: Email HTML Structure
  // The outermost table centers the email content and sets a max width.
  // We use 600px because that's the safe maximum for most email clients.
  // The DOCTYPE and meta tags help email clients render correctly.
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLORS.background}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <!-- Outer wrapper table — centers content and sets max width -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.background};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <!-- Inner content table — max 600px wide for email clients -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px;">

          <!-- HEADER -->
          <tr>
            <td style="padding: 0 24px 24px 24px; text-align: center;">
              <h1 style="margin: 0 0 4px 0; font-size: 24px; font-weight: 700; color: ${COLORS.accent}; letter-spacing: 1px;">
                Stash
              </h1>
              <p style="margin: 0; font-size: 14px; color: ${COLORS.textLight};">
                Your ${isWeekly ? "weekly" : "daily"} digest &middot; ${escapeHtml(today)}
              </p>
            </td>
          </tr>

          <!-- SECTIONS (each one hides itself if empty) -->
          ${capturesHtml}
          ${uncheckedHtml}
          ${statsHtml}
          ${forgottenHtml}
          ${emptyMessage}

          <!-- FOOTER -->
          <tr>
            <td style="padding: 8px 24px 0 24px; text-align: center;">
              <p style="margin: 0 0 8px 0; font-size: 14px;">
                <a href="${FRONTEND_URL}" style="color: ${COLORS.accent}; text-decoration: none; font-weight: 600;">
                  Open Stash &rarr;
                </a>
              </p>
              <p style="margin: 0; font-size: 12px; color: ${COLORS.textLight}; line-height: 1.5;">
                You're receiving this because you enabled ${isWeekly ? "weekly" : "daily"} digests in Stash settings.
                <br>
                To stop these emails, open Stash and set digest frequency to "None."
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, html };
}

module.exports = { buildDigestEmail, timeAgo };
