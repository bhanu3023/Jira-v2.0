/**
 * patch-users.mjs
 * Extracts all unique reporter/assignee users from L1BOAR and QABOAR
 * and saves to .jira-users-seed.json
 * Run: node patch-users.mjs
 */

import fs from 'fs';
import path from 'path';

const ISSUES_SEED = path.join(process.cwd(), '.jira-issues-seed.json');
const USERS_SEED  = path.join(process.cwd(), '.jira-users-seed.json');

// Skip automated/system senders
const SKIP_PATTERNS = ['no-reply','noreply','drive-shares','notice@transfer','notetaker','@box.com','@otter.ai','@fathom.video','@fyxer.com','@teams.mail.microsoft'];
function shouldSkip(email) {
  const e = (email || '').toLowerCase();
  return SKIP_PATTERNS.some(p => e.includes(p));
}

function toSlug(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '.');
}

// For Jira internal users (accountId@jira.com), derive a clean email from display name
function resolveEmail(u) {
  const raw = (u.email || '').toLowerCase();
  if (!raw.endsWith('@jira.com') && !raw.endsWith('@atlassian.net')) return raw;
  // Derive from displayName: "Sai Kiran Reddy" → "sai.kiran.reddy@cloudfuze.com"
  const name = (u.firstName + ' ' + u.lastName).trim();
  if (!name || name === 'Unknown') return null;
  return toSlug(name) + '@cloudfuze.com';
}

const seedIssues = JSON.parse(fs.readFileSync(ISSUES_SEED, 'utf-8'));
const BOARDS = ['L1BOAR', 'QABOAR'];
const usersMap = {};

seedIssues
  .filter(i => BOARDS.some(b => String(i.key || '').startsWith(b)))
  .forEach(i => {
    const board = BOARDS.find(b => String(i.key || '').startsWith(b));
    [i.reporter, i.assignee].forEach(u => {
      if (!u || !u.firstName || u.firstName === 'Unknown') return;
      const resolvedEmail = resolveEmail(u);
      if (!resolvedEmail || shouldSkip(resolvedEmail)) return;

      if (!usersMap[resolvedEmail]) {
        // Clean up names that are email addresses used as display names
        let firstName = u.firstName.includes('@') ? u.firstName.split('@')[0] : u.firstName;
        let lastName  = u.lastName  && u.lastName.includes('@')  ? '' : (u.lastName || '');
        // Capitalize first letter
        firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        lastName  = lastName.charAt(0).toUpperCase()  + lastName.slice(1);

        usersMap[resolvedEmail] = {
          id: `usr_${resolvedEmail.replace(/[^a-z0-9]/gi, '_')}`,
          email: resolvedEmail,
          firstName,
          lastName,
          role: 'agent',
          isActive: true,
          password: 'changeme123',
          boards: [],
        };
      }
      if (!usersMap[resolvedEmail].boards.includes(board)) {
        usersMap[resolvedEmail].boards.push(board);
      }
    });
  });

const userList = Object.values(usersMap);
const l1 = userList.filter(u => u.boards.includes('L1BOAR')).length;
const qa = userList.filter(u => u.boards.includes('QABOAR')).length;

console.log(`Total unique users : ${userList.length}`);
console.log(`  L1BOAR members   : ${l1}`);
console.log(`  QABOAR members   : ${qa}`);
console.log(`  Both boards      : ${userList.filter(u => u.boards.length === 2).length}`);

fs.writeFileSync(USERS_SEED, JSON.stringify(userList, null, 2), 'utf-8');
const kb = (fs.statSync(USERS_SEED).size / 1024).toFixed(1);
console.log(`\nSaved ${userList.length} users to .jira-users-seed.json (${kb} KB)`);
