// ============================================================
// SENDGRID EMAIL SENDER
//
// Wraps the SendGrid API for sending digest emails.
// Requires SENDGRID_API_KEY and SENDGRID_FROM_EMAIL env vars.
//
// KEY CONCEPT: API Wrappers
// Instead of calling SendGrid's API directly everywhere, we
// wrap it in a single function. This way:
// 1. All email-sending logic is in one place
// 2. Error handling is consistent
// 3. If we ever switch from SendGrid to another provider
//    (Mailgun, Postmark, etc.), we only change this one file
//
// KEY CONCEPT: SendGrid
// SendGrid is a cloud email service. You can't just send emails
// from any server — they'd get flagged as spam. SendGrid handles
// email deliverability, reputation management, and spam compliance.
// You get an API key from sendgrid.com and use their SDK to send.
// ============================================================

const sgMail = require("@sendgrid/mail");

// Set the API key once — the SDK stores it internally and
// uses it for all subsequent send() calls
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Send a single email via SendGrid.
 *
 * @param {Object} options
 * @param {string} options.to      - Recipient email address
 * @param {string} options.subject - Email subject line
 * @param {string} options.html    - HTML body content
 * @returns {boolean} true if sent successfully, false if failed
 */
async function sendEmail({ to, subject, html }) {
  // Build the message object that SendGrid expects
  const msg = {
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject,
    html,
  };

  try {
    // sgMail.send() returns a promise that resolves when SendGrid
    // accepts the email. Note: "accepted" doesn't mean "delivered" —
    // SendGrid queues it and handles actual delivery asynchronously.
    await sgMail.send(msg);
    console.log(`[Email] Sent to ${to}: "${subject}"`);
    return true;
  } catch (err) {
    // Log the error but don't crash — the scheduler will continue
    // processing other users even if one email fails
    console.error(`[Email] Failed to send to ${to}:`, err.message);

    // SendGrid errors often include a response body with details
    // (e.g., "invalid API key", "sender not verified", etc.)
    if (err.response) {
      console.error("[Email] SendGrid response:", err.response.body);
    }
    return false;
  }
}

module.exports = { sendEmail };
