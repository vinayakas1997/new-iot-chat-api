/**
 * send_notification (§5.7). In-app delivery (the History write) is always done
 * by the caller; this handles the optional outbound channels. Best-effort — a
 * failed webhook/email must not fail the report run.
 */
import { config } from '../config.js';
import { logger } from '../logger.js';

export async function deliverExternal(subject: string, body: string): Promise<void> {
  if (config.delivery.webhookUrl) {
    try {
      await fetch(config.delivery.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
    } catch (err) {
      logger.warn({ err }, 'report webhook delivery failed');
    }
  }
  // SMTP intentionally left as a stub: wire nodemailer here against config.delivery.smtpUrl
  // when an SMTP endpoint is available. Kept out to avoid the dependency in mock mode.
  if (config.delivery.smtpUrl) {
    logger.info({ subject }, 'SMTP configured but nodemailer not wired — skipping email');
  }
}
