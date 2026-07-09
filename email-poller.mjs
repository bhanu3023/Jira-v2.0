/**
 * email-poller.mjs
 * Polls your IMAP inbox every 30 seconds and forwards new emails
 * to the local webhook: POST http://localhost:8080/api/email/receive
 *
 * Run: node email-poller.mjs
 *
 * Requirements:
 *   npm install imapflow nodemailer dotenv
 */

import { ImapFlow } from 'imapflow';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// Load .env manually
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '.env');
try {
  const lines = readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
} catch { /* no .env file */ }

const WEBHOOK_URL = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:8080'}/api/email/receive`;
const IMAP_HOST   = process.env.IMAP_HOST     || 'imap.gmail.com';
const IMAP_PORT   = parseInt(process.env.IMAP_PORT || '993');
const IMAP_SECURE = process.env.IMAP_SECURE   !== 'false';
const EMAIL_USER  = process.env.EMAIL_USER;
const EMAIL_PASS  = process.env.EMAIL_PASSWORD;
const SPACE_KEY   = process.env.EMAIL_SPACE_KEY || 'L1BOAR';
const POLL_MS     = parseInt(process.env.EMAIL_POLL_INTERVAL || '30000');

if (!EMAIL_USER || !EMAIL_PASS) {
  console.error('❌ Set EMAIL_USER and EMAIL_PASSWORD in your .env file');
  process.exit(1);
}

console.log(`📧 Email Poller starting...`);
console.log(`   Inbox  : ${EMAIL_USER}`);
console.log(`   Space  : ${SPACE_KEY}`);
console.log(`   Webhook: ${WEBHOOK_URL}`);
console.log(`   Poll   : every ${POLL_MS / 1000}s\n`);

let lastUid = 0;

async function pollOnce() {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_SECURE,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Fetch all unseen messages (or messages after last UID)
      const query = lastUid > 0
        ? { uid: `${lastUid + 1}:*`, seen: false }
        : { seen: false };

      for await (const msg of client.fetch(query, {
        envelope: true,
        bodyStructure: true,
        source: true,
        uid: true,
        headers: ['message-id', 'in-reply-to', 'references'],
      })) {
        if (msg.uid <= lastUid) continue;
        lastUid = Math.max(lastUid, msg.uid);

        const env = msg.envelope;
        const from    = env.from?.[0]  ? `${env.from[0].name || ''} <${env.from[0].address}>`.trim()  : '';
        const to      = env.to?.[0]    ? `${env.to[0].name   || ''} <${env.to[0].address}>`.trim()    : EMAIL_USER;
        const subject = env.subject || '(no subject)';

        // Extract headers
        const hdrs     = msg.headers ? Object.fromEntries(
          [...msg.headers.entries()].map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v])
        ) : {};
        const messageId  = hdrs['message-id']  || '';
        const inReplyTo  = hdrs['in-reply-to'] || '';
        const references = hdrs['references']  || '';

        // Get plain text body from source
        let body = '';
        try {
          const src = msg.source?.toString('utf8') || '';
          // Simple extraction: text after headers (blank line)
          const headerEnd = src.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            body = src.slice(headerEnd + 4).replace(/<[^>]+>/g, '').trim();
          }
        } catch { /* ignore */ }

        console.log(`\n📨 New email from: ${from}`);
        console.log(`   Subject: ${subject}`);
        console.log(`   MessageId: ${messageId}`);

        // Forward to webhook
        try {
          const res = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from, to, subject, body,
              messageId, inReplyTo, references,
              spaceKey: SPACE_KEY,
            }),
          });
          const result = await res.json();
          if (result.ok) {
            if (result.issueKey) {
              console.log(`   ✅ Created ticket: ${result.issueKey}`);
            } else if (result.comment) {
              console.log(`   💬 Added comment to: ${result.comment.issueKey}`);
            }
          } else {
            console.log(`   ⚠️  Webhook response:`, result);
          }
        } catch (err) {
          console.error(`   ❌ Webhook error:`, err.message);
        }

        // Mark as read so we don't process again
        await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen']);
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    // Connection errors are normal (network blips) — just log and retry
    if (err.code !== 'ECONNRESET' && err.code !== 'ETIMEDOUT') {
      console.error(`[poller] IMAP error:`, err.message);
    }
  }
}

// Run immediately then poll
pollOnce();
setInterval(pollOnce, POLL_MS);
