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
      method: "GET",
      headers: { "Authorization": `Basic ${AUTH}`, "Accept": "application/json" }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  // Check response structure of search/jql for QA project
  const search = await get("/rest/api/3/search/jql?jql=project%3DQA&maxResults=2&fields=summary,status");
  const parsed = JSON.parse(search.body);
  console.log("Top-level keys:", Object.keys(parsed));
  console.log("total:", parsed.total);
  console.log("issues count:", parsed.issues?.length);
  console.log("First issue key:", parsed.issues?.[0]?.key);

  // Count total QA issues
  const count = await get("/rest/api/3/search/jql?jql=project%3DQA&maxResults=1&fields=summary");
  const c = JSON.parse(count.body);
  console.log("\nQA total issues:", c.total);
}
main().catch(console.error);

