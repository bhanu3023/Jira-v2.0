/**
 * recent-items.ts
 * Tracks recently visited issues, spaces and boards in localStorage.
 */

export type RecentItemType = 'issue' | 'space' | 'board';

export interface RecentItem {
  id: string;           // unique key (issue key, space key, etc.)
  type: RecentItemType;
  title: string;
  href: string;
  spaceKey?: string;
  issueType?: string;   // for issues: task / bug / story / epic
  visitedAt: number;    // unix ms
}

const BASE_KEY = 'cf_recent_items';
const MAX = 30;

/** Per-user localStorage key — falls back to shared key for anonymous users */
function userKey(userId?: string | null): string {
  return userId ? `${BASE_KEY}_${userId}` : BASE_KEY;
}

function read(userId?: string | null): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(userKey(userId)) || '[]') as RecentItem[];
  } catch {
    return [];
  }
}

function write(items: RecentItem[], userId?: string | null) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(userKey(userId), JSON.stringify(items));
}

export function trackRecentItem(item: Omit<RecentItem, 'visitedAt'>, userId?: string | null) {
  const items = read(userId).filter((i) => i.id !== item.id); // deduplicate
  items.unshift({ ...item, visitedAt: Date.now() });
  write(items.slice(0, MAX), userId);
}

export function getRecentItems(userId?: string | null): RecentItem[] {
  return read(userId);
}

export function clearRecentItems(userId?: string | null) {
  write([], userId);
}

/** Group items into Today / Yesterday / This week / Older */
export function groupRecentItems(items: RecentItem[]) {
  const now = Date.now();
  const DAY = 86_400_000;
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart - DAY;
  const weekStart = todayStart - 6 * DAY;

  const groups: { label: string; items: RecentItem[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This week', items: [] },
    { label: 'Older', items: [] },
  ];

  for (const item of items) {
    if (item.visitedAt >= todayStart)     groups[0].items.push(item);
    else if (item.visitedAt >= yesterdayStart) groups[1].items.push(item);
    else if (item.visitedAt >= weekStart) groups[2].items.push(item);
    else                                  groups[3].items.push(item);
  }

  return groups.filter((g) => g.items.length > 0);
}
