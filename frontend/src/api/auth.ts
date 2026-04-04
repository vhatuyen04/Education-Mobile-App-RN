import { API_BASE_URL } from '../config/api';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResponse = {
  user: AuthUser;
} & AuthTokens;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

async function deleteJsonAuth<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

async function postJsonAuth<T>(path: string, body: unknown, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

async function getJsonAuth<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

async function putJsonAuth<T>(path: string, body: unknown, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export async function register(email: string, password: string, name?: string): Promise<AuthResponse> {
  return postJson<AuthResponse>('/auth/register', { email, password, name });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return postJson<AuthResponse>('/auth/login', { email, password });
}

export async function logout(refreshToken: string): Promise<{ ok: true }> {
  return postJson<{ ok: true }>('/auth/logout', { refreshToken });
}

export async function updateMeName(accessToken: string, name: string): Promise<{ user: AuthUser }> {
  return putJsonAuth<{ user: AuthUser }>('/auth/me', { name }, accessToken);
}

export async function changeMyPassword(
  accessToken: string,
  body: { oldPassword: string; newPassword: string; confirmNewPassword: string }
): Promise<{ ok: true }> {
  return putJsonAuth<{ ok: true }>('/auth/me/password', body, accessToken);
}

export type AiGoalSuggestion = {
  title: string;
  field: LeaderboardField;
  deadline: string;
  steps: AiGoalStep[];
};

export type AiGoalStepSchedule =
  | { type: 'none' }
  | { type: 'once'; due: string }
  | { type: 'repeat'; repeat: string; repeatDay?: number; repeatMonth?: number };

export type AiGoalStep = {
  text: string;
  schedule: AiGoalStepSchedule;
};

export type AiGoalSuggestResponse =
  | { ok: false; message: string; questions: string[] }
  | { ok: true; suggestion: AiGoalSuggestion };

export async function aiSuggestGoal(
  accessToken: string,
  body: { prompt: string; deadline?: string; intensity?: 'Light' | 'Normal' | 'Hard' }
): Promise<AiGoalSuggestResponse> {
  return postJsonAuth<AiGoalSuggestResponse>('/auth/ai/goal', body, accessToken);
}

export type DashboardGoal = {
  id: string;
  title: string;
  progressPct: number;
  todayPct?: number | null;
  dueAt: string | null;
} | null;

export type GoalItem = {
  id: string;
  title: string;
  description?: string | null;
  progressPct: number;
  dueAt: string | null;
  completed: boolean;
};

export type DashboardEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  repeat: string | null;
} | null;

export type EventItem = {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  repeat: string | null;
  seriesId?: string | null;
  seriesStartAt?: string | null;
  seriesEndAt?: string | null;
};

export type TodayStepItem = {
  id: string;
  goalId: string;
  goalTitle: string;
  text: string;
  dueAt: string | null;
  repeat: string | null;
  repeatDay: number | null;
  repeatMonth: number | null;
  doneToday: boolean;
};

export type DashboardResponse = {
  score: number;
  tasksPlanned: number;
  nextGoal: DashboardGoal;
  nextEvent: DashboardEvent;
  todayEvents: EventItem[];
  todayGoals: Exclude<DashboardGoal, null>[];
  todaySteps: TodayStepItem[];
};

export type LeaderboardField = 'Sport' | 'Academy' | 'Entertainment';

export type LeaderboardEntry = {
  userId: string;
  name: string;
  points: number;
  rank: number | null;
};

export type LeaderboardFieldResponse = {
  field: LeaderboardField;
  topUser: string | null;
  leaders: LeaderboardEntry[];
  me: LeaderboardEntry;
};

export type LeaderboardFieldPageResponse = LeaderboardFieldResponse & {
  total: number;
  limit: number;
  offset: number;
};

export type LeaderboardResponse = {
  leaderboards: LeaderboardFieldResponse[];
};

export async function getDashboard(accessToken: string): Promise<DashboardResponse> {
  return getJsonAuth<DashboardResponse>('/auth/dashboard', accessToken);
}

export async function toggleGoalStepCompletion(
  accessToken: string,
  params: { goalId: string; stepId: string; dateIso: string; done: boolean }
): Promise<{ ok: true }> {
  return postJsonAuth<{ ok: true }>(
    `/auth/goals/${encodeURIComponent(params.goalId)}/steps/${encodeURIComponent(params.stepId)}/completion`,
    { date: params.dateIso, done: params.done },
    accessToken
  );
}

export async function getLeaderboard(accessToken: string): Promise<LeaderboardResponse> {
  return getJsonAuth<LeaderboardResponse>('/auth/leaderboard', accessToken);
}

export async function getLeaderboardField(
  accessToken: string,
  params: { field: LeaderboardField; limit?: number; offset?: number }
): Promise<LeaderboardFieldPageResponse> {
  const sp = new URLSearchParams();
  sp.set('field', params.field);
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.offset !== undefined) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return getJsonAuth<LeaderboardFieldPageResponse>(`/auth/leaderboard/field?${qs}`, accessToken);
}

export async function listGoals(accessToken: string): Promise<{ goals: GoalItem[] }> {
  return getJsonAuth<{ goals: GoalItem[] }>('/auth/goals', accessToken);
}

export async function getGoal(accessToken: string, id: string): Promise<{ goal: GoalItem }> {
  return getJsonAuth<{ goal: GoalItem }>(`/auth/goals/${id}`, accessToken);
}

export async function createGoal(
  accessToken: string,
  body: { title: string; description?: string | null; progressPct?: number; dueAt?: string }
): Promise<{ goal: GoalItem }> {
  return postJsonAuth<{ goal: GoalItem }>('/auth/goals', body, accessToken);
}

export async function createGoalStep(
  accessToken: string,
  goalId: string,
  body: {
    text: string;
    order?: number;
    dueAt?: string | null;
    repeat?: string | null;
    repeatDay?: number | null;
    repeatMonth?: number | null;
  }
): Promise<{ step: { id: string } }>
{
  return postJsonAuth<{ step: { id: string } }>(`/auth/goals/${encodeURIComponent(goalId)}/steps`, body, accessToken);
}

export type GoalStepItem = {
  id: string;
  goalId: string;
  text: string;
  order: number;
  dueAt: string | null;
  repeat: string | null;
  repeatDay: number | null;
  repeatMonth: number | null;
};

export async function listGoalSteps(accessToken: string, goalId: string): Promise<{ steps: GoalStepItem[] }> {
  return getJsonAuth<{ steps: GoalStepItem[] }>(`/auth/goals/${encodeURIComponent(goalId)}/steps`, accessToken);
}

export async function updateGoalStep(
  accessToken: string,
  params: { goalId: string; stepId: string },
  body: { text?: string; order?: number; dueAt?: string | null; repeat?: string | null; repeatDay?: number | null; repeatMonth?: number | null }
): Promise<{ step: GoalStepItem }>
{
  return putJsonAuth<{ step: GoalStepItem }>(
    `/auth/goals/${encodeURIComponent(params.goalId)}/steps/${encodeURIComponent(params.stepId)}`,
    body,
    accessToken
  );
}

export async function deleteGoalStep(
  accessToken: string,
  params: { goalId: string; stepId: string }
): Promise<{ ok: true }>
{
  return deleteJsonAuth<{ ok: true }>(
    `/auth/goals/${encodeURIComponent(params.goalId)}/steps/${encodeURIComponent(params.stepId)}`,
    accessToken
  );
}

export async function updateGoal(
  accessToken: string,
  id: string,
  body: { title?: string; description?: string | null; progressPct?: number; dueAt?: string | null; completed?: boolean }
): Promise<{ goal: GoalItem }> {
  return putJsonAuth<{ goal: GoalItem }>(`/auth/goals/${id}`, body, accessToken);
}

export async function deleteGoal(accessToken: string, id: string): Promise<{ ok: true }> {
  return deleteJsonAuth<{ ok: true }>(`/auth/goals/${id}`, accessToken);
}

export async function listEvents(accessToken: string, params?: { from?: string; to?: string }): Promise<{ events: EventItem[] }> {
  const sp = new URLSearchParams();
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  const qs = sp.toString();
  return getJsonAuth<{ events: EventItem[] }>(`/auth/events${qs ? `?${qs}` : ''}`, accessToken);
}

export async function createEvent(
  accessToken: string,
  body: { title: string; startAt: string; endAt?: string; repeat?: string; seriesEndAt?: string }
): Promise<{ event: EventItem }> {
  return postJsonAuth<{ event: EventItem }>('/auth/events', body, accessToken);
}

export async function updateEvent(
  accessToken: string,
  id: string,
  body: { title?: string; startAt?: string; endAt?: string | null; repeat?: string | null },
  opts?: { scope?: 'series' | 'single' }
): Promise<{ event: EventItem }> {
  const sp = new URLSearchParams();
  if (opts?.scope) sp.set('scope', opts.scope);
  const qs = sp.toString();
  return putJsonAuth<{ event: EventItem }>(`/auth/events/${id}${qs ? `?${qs}` : ''}`, body, accessToken);
}

export async function deleteEvent(accessToken: string, id: string, opts?: { scope?: 'series' | 'single' }): Promise<{ ok: true }> {
  const sp = new URLSearchParams();
  if (opts?.scope) sp.set('scope', opts.scope);
  const qs = sp.toString();
  return deleteJsonAuth<{ ok: true }>(`/auth/events/${id}${qs ? `?${qs}` : ''}`, accessToken);
}
