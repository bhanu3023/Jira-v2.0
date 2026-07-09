/**
 * fix-sops-descriptions.mjs
 * Fetches properly rendered HTML descriptions from Jira for ALL SOPS tickets
 * and updates them in the DB so tables/formatting show correctly.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import https from 'https';

const DB_URL  = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const adapter = new PrismaPg({ connectionString: DB_URL });
const prisma  = new PrismaClient({ adapter });

const AUTH = Buffer.from(
  'sujana.manapuram@cloudfuze.com:REDACTED_API_TOKEN'
).toString('base64');

function jiraGet(path) {
  return new Promise((resolve, reject) => {
    https.get(
      { hostname: 'cf2020.atlassian.net', path, headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); }
    ).on('error', reject);
  });
}

/** Clean Jira rendered HTML â€” strip font tags, confluence classes, signature junk */
function cleanJiraHtml(html) {
  if (!html) return '';
  let h = html;

  // Remove <font color=...> tags (keep content)
  h = h.replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '');

  // Fix table classes â†’ clean table styling
  h = h.replace(/class=['"]confluenceTable['"]/gi, 'style="border-collapse:collapse;width:100%;margin:8px 0;"');
  h = h.replace(/class=['"]confluenceTd['"]/gi, 'style="border:1px solid #ddd;padding:6px 10px;"');
  h = h.replace(/class=['"]confluenceTh['"]/gi, 'style="border:1px solid #ddd;padding:6px 10px;font-weight:bold;background:#f5f5f5;"');
  h = h.replace(/class=['"]table-wrap['"]/gi, '');

  // Strip Jira wiki image markup: !filename.png|thumbnail!
  h = h.replace(/![\w\s\-.()+@]+\.(png|jpg|gif|jpeg)\|[^!]*!/gi, '');
  h = h.replace(/![\w\s\-.()+@]+\.(png|jpg|gif|jpeg)!/gi, '');

  // Strip signature block â€” everything after "Thanks," or "Regards," followed by name + tracking URLs
  h = h.replace(/<p[^>]*>\s*Thanks,?[\s\S]*$/i, '');
  h = h.replace(/<p[^>]*>\s*Regards,?[\s\S]*$/i, '');
  h = h.replace(/<p[^>]*>\s*Best,?[\s\S]*$/i, '');

  // Strip HubSpot / tracking URLs (very long URLs)
  h = h.replace(/<a[^>]*href=["'][^"']{150,}["'][^>]*>[\s\S]*?<\/a>/gi, '');
  h = h.replace(/< https?:\/\/[^\s>]{100,} >/gi, '');

  // Strip empty paragraphs
  h = h.replace(/<p[^>]*>\s*<\/p>/gi, '');
  h = h.replace(/(<br\s*\/?>\s*){3,}/gi, '<br/><br/>');

  return h.trim();
}

async function main() {
  // Get all SOPS DB issues
  const space = await prisma.space.findUnique({ where: { key: 'SOPSBOARD' } });
  if (!space) { console.error('SOPSBOARD not found'); return; }

  const dbIssues = await prisma.issue.findMany({
    where: { spaceId: space.id },
    select: { id: true, key: true, description: true },
    orderBy: { key: 'asc' }
  });

  console.log(`Found ${dbIssues.length} SOPSBOARD tickets\n`);

  let fixed = 0, skipped = 0, noDesc = 0;

  for (const issue of dbIssues) {
    // Map our key (SOPS-93 or SOPSBOARD-94) to Jira key
    const jiraKey = issue.key.startsWith('SOPS-') ? issue.key : null;
    if (!jiraKey) { skipped++; continue; } // SOPSBOARD-xx keys are email-created, skip

    try {
      const data = await jiraGet(`/rest/api/3/issue/${jiraKey}?expand=renderedFields`);
      const rendered = data.renderedFields?.description;

      if (!rendered) { noDesc++; process.stdout.write('_'); continue; }

      const cleanDesc = cleanJiraHtml(rendered);
      if (!cleanDesc) { noDesc++; process.stdout.write('_'); continue; }

      await prisma.issue.update({ where: { id: issue.id }, data: { description: cleanDesc } });
      fixed++;
      process.stdout.write('âœ“');
      if (fixed % 10 === 0) process.stdout.write(` ${fixed}\n`);

      // Rate limit
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      process.stdout.write('âœ—');
    }
  }

  console.log(`\n\nDone! Fixed: ${fixed} | No description: ${noDesc} | Skipped (email-created): ${skipped}`);
}

main()
  .catch(e => { console.error('FATAL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());

