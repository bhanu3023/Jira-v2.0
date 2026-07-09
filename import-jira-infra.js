const { Pool } = require("pg");
const https = require("https");

const pool = new Pool({ connectionString: "postgresql://postgres:neutara123@localhost:5433/neutara_db" });

const JIRA_URL = "https://cf2020.atlassian.net";
const EMAIL = "sujana.manapuram@cloudfuze.com";
const API_TOKEN = "REDACTED_API_TOKEN";
const PROJECT_KEY = "IN";
const QUEUE_NAME = "Infra";
const SPACE_KEY = "TESTIN";
const AUTH = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString("base64");

function statusId(name) {
  return "status_" + name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function jiraGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, JIRA_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { "Authorization": `Basic ${AUTH}`, "Accept": "application/json" }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Parse error: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchStatuses() {
  const res = await jiraGet(`/rest/api/3/project/${PROJECT_KEY}/statuses`);
  const seen = new Set();
  const statuses = [];
  for (const issueType of res) {
    for (const s of issueType.statuses) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        const catKey = s.statusCategory?.key || "new";
        let category = "todo";
        if (catKey === "indeterminate") category = "in-progress";
        else if (catKey === "done") category = "done";
        statuses.push({ name: s.name, category });
      }
    }
  }
  return statuses;
}

async function fetchAllIssues() {
  const all = [];
  const fields = "summary,description,status,priority,assignee,reporter,created,updated,issuetype";
  const jql = encodeURIComponent(`project = "${PROJECT_KEY}" ORDER BY created ASC`);
  let nextPageToken = null;
  while (true) {
    let url = `/rest/api/3/search/jql?jql=${jql}&maxResults=100&fields=${fields}`;
    if (nextPageToken) url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;
    const res = await jiraGet(url);
    if (res.errorMessages) throw new Error("Jira error: " + JSON.stringify(res.errorMessages));
    all.push(...(res.issues || []));
    process.stdout.write(`\rFetched ${all.length} issues...`);
    if (res.isLast || !res.issues?.length) break;
    nextPageToken = res.nextPageToken;
    if (!nextPageToken) break;
  }
  console.log();
  return all;
}

function adfToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.content) return node.content.map(adfToText).join(" ");
  return "";
}

async function ensureUser(jiraUser) {
  if (!jiraUser || !jiraUser.emailAddress) return null;
  const email = jiraUser.emailAddress;
  const displayName = jiraUser.displayName || "";
  const avatarUrl = jiraUser.avatarUrls?.["48x48"] || "";
  const parts = displayName.trim().split(" ");
  const uid = "usr_" + email.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  await pool.query(
    `INSERT INTO users (id, email, "firstName", "lastName", "avatarUrl", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
     ON CONFLICT (email) DO UPDATE SET "firstName"=$3, "lastName"=$4, "avatarUrl"=$5`,
    [uid, email, parts[0] || "", parts.slice(1).join(" ") || "", avatarUrl]
  );
  return uid;
}

async function main() {
  const spaceRow = await pool.query("SELECT id FROM spaces WHERE key = $1", [SPACE_KEY]);
  if (!spaceRow.rows.length) throw new Error("TESTIN space not found");
  const spaceId = spaceRow.rows[0].id;

  // Fetch and create statuses
  console.log("Fetching Infra statuses from Jira...");
  const statuses = await fetchStatuses();
  console.log("Statuses:", statuses.map(s => `"${s.name}" (${s.category})`).join(", "));
  for (const s of statuses) {
    await pool.query(
      `INSERT INTO statuses (id, name, category, "spaceId") VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET name=$2, category=$3`,
      [statusId(s.name), s.name, s.category, spaceId]
    );
  }

  const issues = await fetchAllIssues();
  console.log(`Total Infra issues from Jira: ${issues.length}`);

  let inserted = 0, updated = 0, errors = 0;

  for (const jIssue of issues) {
    try {
      const key = jIssue.key;
      const f = jIssue.fields;
      const summary = f.summary || "(no title)";
      const description = f.description ? adfToText(f.description) : "";
      const sid = statusId(f.status?.name || "Open");
      const priority = f.priority?.name || "Medium";
      const reporterId = await ensureUser(f.reporter);
      const assigneeId = await ensureUser(f.assignee);
      const issueId = "issue_" + key.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const createdAt = f.created ? new Date(f.created) : new Date();
      const updatedAt = f.updated ? new Date(f.updated) : new Date();

      const existing = await pool.query("SELECT id FROM issues WHERE key = $1", [key]);
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE issues SET summary=$1, description=$2, "statusId"=$3, priority=$4,
           "reporterId"=$5, "assigneeId"=$6, current_department=$7, original_dept=$7, "updatedAt"=$8
           WHERE key=$9`,
          [summary, description, sid, priority, reporterId, assigneeId, QUEUE_NAME, updatedAt, key]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO issues (id, key, summary, description, "statusId", priority,
           "reporterId", "assigneeId", "spaceId", current_department, original_dept, "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12)`,
          [issueId, key, summary, description, sid, priority, reporterId, assigneeId, spaceId, QUEUE_NAME, createdAt, updatedAt]
        );
        inserted++;
      }

      for (const uid of [reporterId, assigneeId]) {
        if (!uid) continue;
        const ex = await pool.query('SELECT 1 FROM space_members WHERE "spaceId"=$1 AND "userId"=$2', [spaceId, uid]);
        if (!ex.rows.length) {
          await pool.query(
            'INSERT INTO space_members (id,"spaceId","userId",role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [`sm_testin_${uid}_${Math.random().toString(36).slice(2)}`, spaceId, uid, "member"]
          );
        }
      }

      if ((inserted + updated) % 200 === 0 && (inserted + updated) > 0)
        process.stdout.write(`\r  Progress: ${inserted} inserted, ${updated} updated, ${errors} errors`);
    } catch (e) {
      errors++;
      if (errors <= 3) console.error(`\nError on ${jIssue?.key}:`, e.message);
    }
  }

  console.log(`\nDone! Inserted: ${inserted}, Updated: ${updated}, Errors: ${errors}`);

  const dist = await pool.query(`
    SELECT s.name, s.category, COUNT(*) as cnt
    FROM issues i JOIN statuses s ON s.id = i."statusId"
    WHERE i.current_department = $1
    GROUP BY s.name, s.category ORDER BY cnt DESC
  `, [QUEUE_NAME]);
  console.log("\nStatus distribution:");
  for (const r of dist.rows) console.log(`  "${r.name}" (${r.category}): ${r.cnt}`);

  await pool.end();
}
main().catch(console.error);

