const https = require("https");

const JIRA_URL = "https://cf2020.atlassian.net";
const EMAIL = "sujana.manapuram@cloudfuze.com";
const API_TOKEN = "REDACTED_API_TOKEN";
const AUTH = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString("base64");

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, JIRA_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { "Authorization": `Basic ${AUTH}`, "Accept": "application/json" }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  // Get all statuses for QA project
  const statuses = await get("/rest/api/3/project/QA/statuses");
  console.log("QA Statuses:");
  for (const issueType of statuses) {
    for (const s of issueType.statuses) {
      console.log(`  "${s.name}" â†’ category: "${s.statusCategory?.name}" (key: ${s.statusCategory?.key})`);
    }
  }

  // Get priorities
  const priorities = await get("/rest/api/3/priority");
  console.log("\nPriorities:");
  for (const p of (priorities.priorities || priorities)) {
    console.log(`  "${p.name}"`);
  }
}
main().catch(console.error);

