const { Pool } = require("pg");
const https = require("https");
const pool = new Pool({ connectionString: "postgresql://postgres:neutara123@localhost:5433/neutara_db" });

const AUTH = Buffer.from("sujana.manapuram@cloudfuze.com:REDACTED_API_TOKEN").toString("base64");

function jiraGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, "https://cf2020.atlassian.net");
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search,
      headers: { "Authorization": `Basic ${AUTH}`, "Accept": "application/json" }
    }, (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(JSON.parse(d))); });
    req.on("error", reject); req.end();
  });
}

async function main() {
  console.log("=== DB Priority Distribution ===");
  const queues = ["QA", "Infra", "SalesOps"];
  for (const q of queues) {
    const res = await pool.query(
      "SELECT priority, COUNT(*) as cnt FROM issues WHERE current_department=$1 GROUP BY priority ORDER BY cnt DESC",
      [q]
    );
    console.log(`\n${q}:`);
    for (const r of res.rows) console.log(`  "${r.priority}": ${r.cnt}`);
  }

  // Check actual Jira priorities for SOPS
  console.log("\n=== Jira SOPS sample priorities ===");
  const res = await jiraGet("/rest/api/3/search/jql?jql=project%3D%22SOPS%22&maxResults=10&fields=summary,priority");
  for (const issue of res.issues) {
    console.log(`  ${issue.key}: priority="${issue.fields.priority?.name}"`);
  }

  // Check Jira priority distribution for all 85 SOPS issues
  const all = await jiraGet("/rest/api/3/search/jql?jql=project%3D%22SOPS%22&maxResults=100&fields=priority");
  const counts = {};
  for (const i of all.issues) {
    const p = i.fields.priority?.name || "null";
    counts[p] = (counts[p] || 0) + 1;
  }
  console.log("\nJira SOPS full priority distribution:", JSON.stringify(counts));

  await pool.end();
}
main().catch(console.error);

