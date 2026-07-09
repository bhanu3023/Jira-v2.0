import { create } from 'zustand';
import { User, Space, Issue, Sprint, Notification, DashboardData } from '@/types';
import { api } from '@/lib/api';

/** Bumped when login/register starts so a stale in-flight `loadUser` cannot clear the new session. */
let authEpoch = 0;

let loadSpacesInflight: Promise<void> | null = null;
let loadNotificationsInflight: Promise<void> | null = null;

interface AppState {
  // Auth
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;

  // Spaces
  spaces: Space[];
  currentSpace: Space | null;
  loadSpaces: () => Promise<void>;
  loadSpace: (key: string) => Promise<void>;
  createSpace: (data: any) => Promise<void>;

  // Issues
  issues: Issue[];
  currentIssue: Issue | null;
  issueTotal: number;
  issuePage: number;
  loadIssues: (params?: Record<string, string>) => Promise<void>;
  loadIssue: (key: string) => Promise<void>;
  createIssue: (data: any) => Promise<any>;
  updateIssue: (key: string, data: any) => Promise<void>;
  clearCurrentIssue: () => void;

  // Sprints
  sprints: Sprint[];
  loadSprints: (params?: Record<string, string>) => Promise<void>;
  createSprint: (data: any) => Promise<void>;

  // Notifications
  notifications: Notification[];
  unreadCount: number;
  loadNotifications: () => Promise<void>;

  // Dashboard
  dashboard: DashboardData | null;
  loadDashboard: (spaceKey?: string) => Promise<void>;

  // UI
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  loading: boolean;
}

export const useStore = create<AppState>((set, get) => ({
  // Auth
  user: null,
  token: null,
  isAuthenticated: false,
  initializing: true,

  login: async (email, password) => {
    authEpoch++;
    const epoch = authEpoch;
    const { token, user } = await api.login(email, password);
    if (epoch !== authEpoch) return;
    localStorage.setItem('jira_token', token);
    set({ user, token, isAuthenticated: true, initializing: false });
  },

  register: async (data) => {
    authEpoch++;
    const epoch = authEpoch;
    const { token, user } = await api.register(data);
    if (epoch !== authEpoch) return;
    localStorage.setItem('jira_token', token);
    set({ user, token, isAuthenticated: true, initializing: false });
  },

  logout: () => {
    authEpoch++;
    localStorage.removeItem('jira_token');
    set({ user: null, token: null, isAuthenticated: false, spaces: [], issues: [], notifications: [] });
  },

  loadUser: async () => {
    const epochAtStart = authEpoch;
    try {
      const token = localStorage.getItem('jira_token');
      if (!token) {
        set({ user: null, token: null, isAuthenticated: false, initializing: false });
        return;
      }
      set({ token });
      const user = await api.getMe();
      if (epochAtStart !== authEpoch) return;
      set({ user, isAuthenticated: true, initializing: false });
    } catch (err: any) {
      if (epochAtStart !== authEpoch) return;
      // Only clear session on explicit auth failure — not on server/DB errors.
      // 401 is already handled in api.ts (redirects to login + removes token).
      const msg = err?.message || '';
      const isServerError = msg.includes('Database') || msg.includes('server error') || msg.includes('503') || msg.includes('500');
      if (isServerError) {
        // Keep token; mark as authenticated with a placeholder so the app loads
        set({ isAuthenticated: true, initializing: false });
      } else {
        set({ user: null, token: null, isAuthenticated: false, initializing: false });
        localStorage.removeItem('jira_token');
      }
    }
  },

  // Spaces
  spaces: [],
  currentSpace: null,
  loadSpaces: async () => {
    if (loadSpacesInflight) return loadSpacesInflight;
    loadSpacesInflight = (async () => {
      const spaces = await api.getSpaces();
      set({ spaces });
    })().finally(() => {
      loadSpacesInflight = null;
    });
    return loadSpacesInflight;
  },
  loadSpace: async (key) => {
    // Don't clear currentSpace before fetching — keeps old data visible instantly
    // while fresh data loads, eliminating the blank-spinner flash on navigation.
    const space = await api.getSpace(key);
    set({ currentSpace: space });
  },
  createSpace: async (data) => {
    await api.createSpace(data);
    await get().loadSpaces();
  },

  // Issues
  issues: [],
  currentIssue: null,
  issueTotal: 0,
  issuePage: 1,
  loadIssues: async (params = {}) => {
    // Don't set loading:true — keeps existing issues visible while refreshing,
    // so navigating between sections feels instant with no blank flash.
    const data = await api.getIssues(params);
    set({ issues: data.issues, issueTotal: data.total, issuePage: data.page });
  },
  loadIssue: async (key) => {
    try {
      const issue = await api.getIssue(key);
      set({ currentIssue: issue });
    } catch {
      set({ currentIssue: null });
    }
  },
  createIssue: async (data) => {
    const issue = await api.createIssue(data);
    return issue;
  },
  updateIssue: async (key, data) => {
    await api.updateIssue(key, data);
  },
  clearCurrentIssue: () => set({ currentIssue: null }),

  // Sprints
  sprints: [],
  loadSprints: async (params = {}) => {
    const sprints = await api.getSprints(params);
    set({ sprints });
  },
  createSprint: async (data) => {
    await api.createSprint(data);
  },

  // Notifications
  notifications: [],
  unreadCount: 0,
  loadNotifications: async () => {
    if (loadNotificationsInflight) return loadNotificationsInflight;
    loadNotificationsInflight = (async () => {
      const { notifications, unreadCount } = await api.getNotifications();
      set({ notifications, unreadCount });
    })().finally(() => {
      loadNotificationsInflight = null;
    });
    return loadNotificationsInflight;
  },

  // Dashboard
  dashboard: null,
  loadDashboard: async (spaceKey) => {
    const dashboard = await api.getDashboard(spaceKey);
    set({ dashboard });
  },

  // UI
  sidebarOpen: true,
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  loading: false,
}));
