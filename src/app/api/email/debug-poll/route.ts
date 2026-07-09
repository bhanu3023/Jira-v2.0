import { NextRequest, NextResponse } from 'next/server';
import { getActivePollers } from '@/lib/email-service';
import { getOAuthTokens, getValidAccessToken } from '@/lib/oauth-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email') || 'jira.salesops@cloudfuze.com';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:8080';
  const webhookUrl = `${appUrl}/api/email/receive`;

  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log('[DebugPoll]', msg); };

  try {
    // 1. Check active pollers
    const pollers = getActivePollers();
    log(`Active pollers: ${JSON.stringify(pollers.map((p: any) => p.email))}`);
    const pollerForEmail = pollers.find((p: any) => p.email?.toLowerCase() === email.toLowerCase());
    log(`Poller for ${email}: ${pollerForEmail ? 'RUNNING spaceKey=' + pollerForEmail.spaceKey : 'NOT RUNNING'}`);

    // 2. Get OAuth token
    const tokens = getOAuthTokens(email);
    log(`OAuth tokens stored: ${tokens ? 'YES provider=' + tokens.provider + ' spaceKey=' + tokens.spaceKey : 'NO'}`);

    let accessToken: string | undefined;
    if (tokens) {
      accessToken = await getValidAccessToken(email) ?? undefined;
      log(`Access token: ${accessToken ? 'VALID length=' + accessToken.length : 'EXPIRED/NULL'}`);
    }

    if (!accessToken) {
      return NextResponse.json({ ok: false, error: 'No valid access token for ' + email, logs });
    }

    const since = new Date(); since.setDate(since.getDate() - 3);
    const sinceStr = since.toISOString();

    // 3a. Try to get a Graph-scoped token from the refresh token
    let graphToken: string | null = null;
    const storedTokens = tokens!;
    if (storedTokens.refreshToken) {
      log(`Trying to get Graph-scoped token from refresh token...`);
      const refreshRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          client_id:     process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          refresh_token: storedTokens.refreshToken,
          scope:         'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access email openid profile',
        }),
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        graphToken = refreshData.access_token || null;
        log(`Graph token obtained: ${graphToken ? 'YES length=' + graphToken.length : 'NO'}`);
      } else {
        const refreshErr = await refreshRes.text();
        log(`Graph token refresh failed (${refreshRes.status}): ${refreshErr.slice(0, 200)}`);
      }
    }

    let graphMessages: any[] = [];

    if (graphToken) {
      // 3b. Use Graph API with the fresh Graph-scoped token
      log(`Using Graph API with fresh Graph-scoped token`);
      const graphUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages?$top=20&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${sinceStr}&$select=id,subject,from,toRecipients,ccRecipients,body,internetMessageId,receivedDateTime,hasAttachments`;
      const graphRes = await fetch(graphUrl, {
        headers: { Authorization: `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
      });
      if (graphRes.ok) {
        const graphData = await graphRes.json();
        const rawMsgs: any[] = graphData.value || [];

        // For each message with inline images, fetch attachments and embed as data: URLs
        for (const m of rawMsgs) {
          let bodyContent = m.body?.content || m.subject;
          const hasCidRef = bodyContent.includes('cid:');
          if (m.id && (m.hasAttachments || hasCidRef)) {
            try {
              const attRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${m.id}/attachments`, {
                headers: { Authorization: `Bearer ${graphToken}`, Accept: 'application/json' },
              });
              if (attRes.ok) {
                const attData = await attRes.json();
                for (const att of (attData.value || [])) {
                  if (att.isInline && att.contentId && att.contentBytes) {
                    const cid = att.contentId.replace(/^<|>$/g, '');
                    const dataUrl = `data:${att.contentType || 'image/png'};base64,${att.contentBytes}`;
                    bodyContent = bodyContent.replace(new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), dataUrl);
                  }
                }
                log(`Embedded ${(attData.value||[]).filter((a:any)=>a.isInline).length} inline image(s) for "${m.subject}"`);
              }
            } catch (e: any) { log(`Attachment fetch failed for "${m.subject}": ${e.message}`); }
          }
          graphMessages.push({
            InternetMessageId: m.internetMessageId,
            Subject: m.subject,
            From: { EmailAddress: { Address: m.from?.emailAddress?.address } },
            ToRecipients: [{ EmailAddress: { Address: m.toRecipients?.[0]?.emailAddress?.address || email } }],
            Body: { Content: bodyContent },
          });
        }
        log(`Graph API returned ${graphMessages.length} messages`);
      } else {
        const graphErr = await graphRes.text();
        log(`Graph API failed (${graphRes.status}): ${graphErr.slice(0, 200)}`);
      }
    } else {
      // 3c. Fallback: EWS (Exchange Web Services) — works with Exchange/IMAP token
      log(`No Graph token available, trying EWS...`);
      const sinceEws = since.toISOString().replace(/\.\d{3}Z$/, 'Z');
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Header><t:RequestServerVersion Version="Exchange2013_SP1"/></soap:Header>
  <soap:Body>
    <m:FindItem Traversal="Shallow">
      <m:ItemShape><t:BaseShape>AllProperties</t:BaseShape></m:ItemShape>
      <m:IndexedPageItemView MaxEntriesReturned="20" Offset="0" BasePoint="Beginning"/>
      <m:Restriction>
        <t:IsGreaterThanOrEqualTo>
          <t:FieldURI FieldURI="item:DateTimeReceived"/>
          <t:FieldURIOrConstant><t:Constant Value="${sinceEws}"/></t:FieldURIOrConstant>
        </t:IsGreaterThanOrEqualTo>
      </m:Restriction>
      <m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>
      <m:ParentFolderIds><t:DistinguishedFolderId Id="inbox"/></m:ParentFolderIds>
    </m:FindItem>
  </soap:Body>
</soap:Envelope>`;
      const ewsRes = await fetch('https://outlook.office365.com/EWS/Exchange.asmx', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'text/xml; charset=utf-8', Accept: 'text/xml' },
        body: soapBody,
      });
      if (ewsRes.ok) {
        const ewsXml = await ewsRes.text();
        log(`EWS response received (${ewsXml.length} bytes)`);
        const itemMatches = Array.from(ewsXml.matchAll(/<t:Message>([\s\S]*?)<\/t:Message>/g));
        log(`EWS found ${itemMatches.length} messages`);
        for (const m of itemMatches) {
          const part = m[1];
          const getTag = (tag: string) => {
            const r = part.match(new RegExp(`<(?:t:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:t:)?${tag}>`, 'i'));
            return r ? r[1].trim() : '';
          };
          graphMessages.push({
            InternetMessageId: getTag('InternetMessageId') || `<ews_${Date.now()}>`,
            Subject: getTag('Subject'),
            From: { EmailAddress: { Address: getTag('EmailAddress') } },
            ToRecipients: [{ EmailAddress: { Address: email } }],
            Body: { Content: getTag('Subject') },
          });
        }
      } else {
        const ewsErr = await ewsRes.text();
        log(`EWS failed (${ewsRes.status}): ${ewsErr.slice(0, 300)}`);
        return NextResponse.json({ ok: false, error: `All APIs failed. EWS: ${ewsRes.status}`, logs });
      }
    }

    const processedIds: Set<string> = (globalThis as any).__processedMsgIds ?? new Set();
    const toProcess: any[] = [];
    for (const gm of graphMessages) {
      const msgId = gm.InternetMessageId || `<msg_${Date.now()}>`;
      const subj  = gm.Subject || '(no subject)';
      const fromAddr = gm.From?.EmailAddress?.Address || '';
      const toAddr   = gm.ToRecipients?.[0]?.EmailAddress?.Address || email;
      const bodyContent = gm.Body?.Content || subj;
      const already = processedIds.has(msgId);
      log(`MSG subject="${subj}" from=${fromAddr} processed=${already}`);
      if (!already) {
        toProcess.push({ msgId, subject: subj, from: fromAddr, to: toAddr, body: bodyContent });
      }
    }
    log(`Unprocessed: ${toProcess.length}`);

    // 4. Call webhook for each unprocessed
    for (const msg of toProcess) {
      log(`→ Webhook: "${msg.subject}" from ${msg.from}`);
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: msg.from, to: msg.to,
          subject: msg.subject, body: msg.subject,
          messageId: msg.msgId,
        }),
      });
      const result = await res.json().catch(() => ({}));
      log(`← Webhook result: ${JSON.stringify(result)}`);
    }

    return NextResponse.json({ ok: true, logs, total: graphMessages.length, toProcess: toProcess.length });
  } catch (err: any) {
    log(`FATAL ERROR: ${err?.message || String(err)}`);
    return NextResponse.json({ ok: false, error: err?.message, logs }, { status: 500 });
  }
}
