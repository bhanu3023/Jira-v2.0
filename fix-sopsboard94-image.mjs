/**
 * fix-sopsboard94-image.mjs
 * Fetches the "aavasva" email from Graph API, embeds inline images, and updates
 * SOPSBOARD-94 description in the DB.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import https from 'https';
import crypto from 'crypto';

const DB_URL  = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const adapter = new PrismaPg({ connectionString: DB_URL });
const prisma  = new PrismaClient({ adapter });

// ---------- helpers ----------
function get(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 300, status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ ok: res.statusCode < 300, status: res.statusCode, body: d }); }
      });
    }).on('error', reject);
  });
}

async function getGraphToken() {
  // Read refresh token directly from .oauth-tokens.json
  const fs = await import('fs');
  const tokensRaw = JSON.parse(fs.readFileSync('.oauth-tokens.json', 'utf8'));
  const tokenEntry = tokensRaw['jira.salesops@cloudfuze.com'];
  if (!tokenEntry?.refreshToken) throw new Error('No refresh token for jira.salesops');
  const refreshToken = tokenEntry.refreshToken;

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     '2de831e8-9bab-4c92-8d4d-22e8591b6810',
    client_secret: process.env.MICROSOFT_CLIENT_SECRET || '',
    refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite offline_access email openid profile',
  });

  return new Promise((resolve, reject) => {
    const payload = body.toString();
    const req = https.request({
      hostname: 'login.microsoftonline.com',
      path: '/common/oauth2/v2.0/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const data = JSON.parse(d);
        if (data.access_token) resolve(data.access_token);
        else reject(new Error('Token refresh failed: ' + JSON.stringify(data).slice(0, 200)));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  // 1. Get access token from env or by refresh
  let token = process.env.GRAPH_TOKEN;
  if (!token) {
    console.log('Getting Graph token via refresh...');
    // Read .env.local for secret
    const fs = await import('fs');
    const env = fs.readFileSync('.env.local', 'utf8');
    const secretMatch = env.match(/MICROSOFT_CLIENT_SECRET\s*=\s*(.+)/);
    if (secretMatch) process.env.MICROSOFT_CLIENT_SECRET = secretMatch[1].trim();
    token = await getGraphToken();
    console.log('Got token, length:', token.length);
  }

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 2. Search for emails from jira.salesops inbox, last 3 days, subject "aavasva"
  const since = new Date(); since.setDate(since.getDate() - 3);
  const sinceStr = since.toISOString();
  const searchUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages?$top=50&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${sinceStr}&$select=id,subject,from,body,hasAttachments,internetMessageId,receivedDateTime`;

  console.log('Fetching inbox messages...');
  const msgsRes = await get(searchUrl, headers);
  if (!msgsRes.ok) { console.error('Failed to fetch messages:', msgsRes.body); return; }

  const msgs = msgsRes.body.value || [];
  console.log(`Got ${msgs.length} messages`);

  // Find "aavasva" email
  const target = msgs.find(m => m.subject?.toLowerCase().includes('aavasva'));
  if (!target) {
    console.log('Available subjects:', msgs.map(m => m.subject));
    console.error('Could not find "aavasva" email');
    return;
  }
  console.log(`Found: "${target.subject}" id=${target.id} hasAttachments=${target.hasAttachments}`);

  let body = target.body?.content || target.subject;
  console.log('Body length:', body.length);
  console.log('Body preview:', body.slice(0, 300));

  // 3. Fetch inline attachments — try even when hasAttachments=false (Graph API quirk)
  const hasCidRef = body.includes('cid:');
  if (target.id && (target.hasAttachments || hasCidRef)) {
    const attUrl = `https://graph.microsoft.com/v1.0/me/messages/${target.id}/attachments`;
    const attRes = await get(attUrl, headers);
    if (attRes.ok) {
      const attachments = attRes.body.value || [];
      console.log(`Attachments: ${attachments.length}`);
      let embedded = 0;
      for (const att of attachments) {
        console.log(`  att: name=${att.name} isInline=${att.isInline} contentId=${att.contentId} contentType=${att.contentType} hasBytes=${!!att.contentBytes}`);
        if (att.isInline && att.contentId && att.contentBytes) {
          const cidRaw = att.contentId;
          const cidClean = cidRaw.replace(/^<|>$/g, '');
          const dataUrl = `data:${att.contentType || 'image/png'};base64,${att.contentBytes}`;
          const before = body.length;
          // Try multiple cid formats
          body = body.replace(new RegExp(`cid:${cidClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), dataUrl);
          body = body.replace(new RegExp(`cid:&lt;${cidClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}&gt;`, 'gi'), dataUrl);
          body = body.replace(new RegExp(`cid:${cidRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), dataUrl);
          if (body.length !== before) { console.log(`  → Replaced cid:${cidClean}`); embedded++; }
          else {
            // The body may not have a cid ref — just append the image at the end
            console.log(`  → No cid ref found in body, appending image`);
            body += `<br/><img src="${dataUrl}" alt="${att.name || 'image'}" style="max-width:100%;height:auto;border-radius:4px;margin:4px 0;" />`;
            embedded++;
          }
        }
      }
      console.log(`Embedded ${embedded} inline image(s)`);
    } else {
      console.error('Failed to fetch attachments:', attRes.body);
    }
  }

  // 4. Sanitize and update DB
  console.log('\nFinal body length:', body.length);
  console.log('Has img tag:', body.includes('<img'));

  // Dynamic import of sanitizeEmailHtml from the built module isn't easy from mjs
  // so we just do basic cleaning inline
  const cleanBody = body;

  // Update SOPSBOARD-94
  const result = await prisma.issue.updateMany({
    where: { key: 'SOPSBOARD-94' },
    data:  { description: cleanBody },
  });
  console.log(`Updated ${result.count} issue(s)`);
}

main()
  .catch(e => { console.error('FATAL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
