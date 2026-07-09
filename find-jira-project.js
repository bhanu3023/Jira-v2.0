const https = require("https");
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
  // Search all Jira projects for email/content/message migration
  let startAt = 0;
  const all = [];
  while (true) {
    const res = await jiraGet(`/rest/api/3/project/search?maxResults=50&startAt=${startAt}`);
    all.push(...res.values);
    if (res.isLast) break;
    startAt += 50;
  }
  console.log(`Total projects: ${all.length}`);
  console.log("\nEmail/Content/Message/Migration related:");
  for (const p of all) {
    if (p.name.toLowerCase().includes("email") || p.name.toLowerCase().includes("content") ||
        p.name.toLowerCase().includes("message") || p.name.toLowerCase().includes("migration") ||
        ["EB","CB","MB","EMB","CMB","MMB"].includes(p.key)) {
      console.log(`  key="${p.key}" name="${p.name}"`);
    }
  }
  // Also check ticket count for interesting keys
  console.log("\nAll projects with key EB, CB, MB, EMB, CMB, MMB:");
  for (const p of all) {
    if (["EB","CB","MB","EMB","CMB","MMB","EBBOARD","CBBOARD","MBBOARD"].includes(p.key)) {
      console.log(`  key="${p.key}" name="${p.name}"`);
    }
  }
}
main().catch(console.error);

