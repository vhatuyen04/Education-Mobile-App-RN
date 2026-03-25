import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Request, Response, Router } from 'express';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';

import { prisma } from '../utils/prisma.js';
import { getConfig } from '../utils/config.js';

export const authRouter = Router();

const prismaAny = prisma as any;

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});

const UpdateMeSchema = z.object({
  name: z.string().min(1),
});

const CreateGoalSchema = z.object({
  title: z.string().min(1),
  progressPct: z.number().int().min(0).max(100).optional(),
  dueAt: z.string().datetime().optional(),
});

const UpdateGoalSchema = z.object({
  title: z.string().min(1).optional(),
  progressPct: z.number().int().min(0).max(100).optional(),
  dueAt: z.string().datetime().optional().nullable(),
  completed: z.boolean().optional(),
});

const CreateEventSchema = z.object({
  title: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  repeat: z.string().min(1).optional(),
  seriesEndAt: z.string().datetime().optional(),
});

const ListRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const UpdateEventSchema = z.object({
  title: z.string().min(1).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional().nullable(),
  repeat: z.string().min(1).optional().nullable(),
});

const LeaderboardFieldQuerySchema = z.object({
  field: z.enum(['Sport', 'Academy', 'Entertainment']),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function isRepeating(repeat: string | null | undefined) {
  if (!repeat) return false;
  const normalized = repeat.trim().toLowerCase();
  return normalized !== 'once';
}

function addRepeatInterval(date: Date, repeat: string) {
  const d = new Date(date);
  const normalized = repeat.trim().toLowerCase();

  if (normalized === 'daily') {
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (normalized === 'weekly') {
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (normalized === 'monthly') {
    d.setMonth(d.getMonth() + 1);
    return d;
  }
  if (normalized === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  // Unknown repeat type: treat as non-repeating by returning a date after the end.
  d.setFullYear(d.getFullYear() + 100);
  return d;
}

function inferRankFieldFromText(text: string): 'Sport' | 'Academy' | 'Entertainment' {
  const t = (text || '').toLowerCase();
  if (t.includes('gym') || t.includes('run') || t.includes('basket') || t.includes('swim') || t.includes('fitness')) return 'Sport';
  if (t.includes('thesis') || t.includes('study') || t.includes('exam') || t.includes('database') || t.includes('ielts')) return 'Academy';
  if (t.includes('game') || t.includes('lol') || t.includes('movie') || t.includes('music')) return 'Entertainment';
  return 'Academy';
}

function scoreFieldForRankField(field: 'Sport' | 'Academy' | 'Entertainment') {
  if (field === 'Sport') return 'sportScore';
  if (field === 'Entertainment') return 'entertainmentScore';
  return 'academyScore';
}

async function refreshLeaderboardTop(field: 'Sport' | 'Academy' | 'Entertainment') {
  const scoreField = scoreFieldForRankField(field);
  const top = await prismaAny.user.findFirst({
    where: { [scoreField]: { gt: 0 } },
    orderBy: [{ [scoreField]: 'desc' }, { updatedAt: 'asc' }],
    select: { id: true, name: true, [scoreField]: true },
  });

  const points = top ? Number(top[scoreField] ?? 0) : 0;
  const userId = top?.id ?? null;
  const userName = top?.name ?? null;

  await prismaAny.leaderboardTop.upsert({
    where: { field },
    create: { field, userId, userName, points },
    update: { userId, userName, points },
  });
}

async function ensureSeriesForLegacyRepeatingEvent(params: {
  userId: string;
  event: { id: string; title: string; repeat: string | null; startAt: Date; seriesId: string | null };
}) {
  const { userId, event } = params;
  if (event.seriesId) return { seriesId: event.seriesId, assigned: false };
  if (!isRepeating(event.repeat)) return { seriesId: null, assigned: false };

  const repeat = event.repeat!;
  const toleranceMs = 5 * 60 * 1000;

  const candidates = await prismaAny.event.findMany({
    where: {
      userId,
      title: event.title,
      repeat,
      seriesId: null,
    },
    orderBy: [{ startAt: 'asc' }],
    select: { id: true, startAt: true },
    take: 500,
  });

  const idx = candidates.findIndex((e: any) => e.id === event.id);
  if (idx < 0) {
    return { seriesId: null, assigned: false };
  }

  const chain: any[] = [candidates[idx]];

  // Walk backwards
  let i = idx;
  while (i > 0) {
    const prev = candidates[i - 1];
    const current = candidates[i];
    const expected = addRepeatInterval(new Date(prev.startAt), repeat);
    if (Math.abs(expected.getTime() - new Date(current.startAt).getTime()) > toleranceMs) break;
    chain.unshift(prev);
    i -= 1;
  }

  // Walk forwards
  i = idx;
  while (i < candidates.length - 1) {
    const current = candidates[i];
    const next = candidates[i + 1];
    const expected = addRepeatInterval(new Date(current.startAt), repeat);
    if (Math.abs(expected.getTime() - new Date(next.startAt).getTime()) > toleranceMs) break;
    chain.push(next);
    i += 1;
  }

  const seriesId = randomUUID();
  const seriesStartAt = new Date(chain[0].startAt);
  const seriesEndAt = new Date(chain[chain.length - 1].startAt);

  await prismaAny.event.updateMany({
    where: { userId, id: { in: chain.map((e: any) => e.id) } },
    data: { seriesId, seriesStartAt, seriesEndAt },
  });

  return { seriesId, assigned: true };
}

function hasInvalidEmail(error: z.ZodError) {
  return error.issues.some(issue => issue.path[0] === 'email');
}

function signAccessToken(userId: string) {
  const config = getConfig();
  const options: SignOptions = { expiresIn: config.accessTokenTtl as SignOptions['expiresIn'] };
  return jwt.sign({ sub: userId, type: 'access' }, config.jwtAccessSecret as Secret, options);
}

function signRefreshToken(userId: string) {
  const config = getConfig();
  const options: SignOptions = { expiresIn: config.refreshTokenTtl as SignOptions['expiresIn'] };
  return jwt.sign({ sub: userId, type: 'refresh' }, config.jwtRefreshSecret as Secret, options);
}

function getAccessTokenFromReq(req: Request): string | null {
  const raw = req.header('authorization') || req.header('Authorization');
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function verifyAccessToken(token: string): { sub: string } {
  const config = getConfig();
  const payload: any = jwt.verify(token, config.jwtAccessSecret);

  if (!payload?.sub || payload?.type !== 'access') {
    throw new Error('Invalid token');
  }

  return { sub: String(payload.sub) };
}

authRouter.post('/register', async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    if (hasInvalidEmail(parsed.error)) {
      return res.status(400).json({ error: 'Invalid email.' });
    }
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, name: name ?? null },
    select: { id: true, email: true, name: true },
  });

  const accessToken = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id);
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash },
  });

  return res.status(201).json({ user, accessToken, refreshToken });
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    if (hasInvalidEmail(parsed.error)) {
      return res.status(400).json({ error: 'Invalid email.' });
    }
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const accessToken = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id);
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash },
  });

  return res.json({
    user: { id: user.id, email: user.email, name: user.name },
    accessToken,
    refreshToken,
  });
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  const parsed = LogoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const config = getConfig();

  let payload: any;
  try {
    payload = jwt.verify(parsed.data.refreshToken, config.jwtRefreshSecret);
  } catch {
    return res.status(200).json({ ok: true });
  }

  if (!payload?.sub) {
    return res.status(200).json({ ok: true });
  }

  await prisma.user.update({
    where: { id: String(payload.sub) },
    data: { refreshTokenHash: null },
  });

  return res.json({ ok: true });
});

authRouter.put('/me', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const parsed = UpdateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const name = parsed.data.name.trim();
  if (!name) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { name },
    select: { id: true, email: true, name: true },
  });

  return res.json({ user });
});

authRouter.get('/dashboard', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const user = await prismaAny.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, score: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const nextGoalWithDue = await prismaAny.goal.findFirst({
    where: { userId, completed: false, dueAt: { not: null } },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, progressPct: true, dueAt: true },
  });

  const nextGoal =
    nextGoalWithDue ??
    (await prismaAny.goal.findFirst({
      where: { userId, completed: false },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true, title: true, progressPct: true, dueAt: true },
    }));

  const nextEvent = await prismaAny.event.findFirst({
    where: { userId, startAt: { gte: now } },
    orderBy: [{ startAt: 'asc' }],
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      repeat: true,
      seriesId: true,
      seriesStartAt: true,
      seriesEndAt: true,
    },
  });

  const tasksPlanned = await prismaAny.event.count({
    where: { userId, startAt: { gte: startOfDay, lte: endOfDay } },
  });

  const todayEvents = await prismaAny.event.findMany({
    where: { userId, startAt: { gte: startOfDay, lte: endOfDay } },
    orderBy: [{ startAt: 'asc' }],
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      repeat: true,
      seriesId: true,
      seriesStartAt: true,
      seriesEndAt: true,
    },
    take: 20,
  });

  const todayGoals = await prismaAny.goal.findMany({
    where: { userId, completed: false, dueAt: { gte: startOfDay, lte: endOfDay } },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, progressPct: true, dueAt: true },
    take: 20,
  });

  return res.json({
    score: user.score ?? 0,
    tasksPlanned,
    nextGoal,
    nextEvent,
    todayEvents,
    todayGoals,
  });
});

authRouter.get('/events', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const parsed = ListRangeSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query' });
  }

  const from = parsed.data.from ? new Date(parsed.data.from) : null;
  const to = parsed.data.to ? new Date(parsed.data.to) : null;

  const where: any = { userId };
  if (from || to) {
    where.startAt = {
      ...(from ? { gte: from } : null),
      ...(to ? { lte: to } : null),
    };
  }

  const events = await prismaAny.event.findMany({
    where,
    orderBy: [{ startAt: 'asc' }],
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      repeat: true,
      seriesId: true,
      seriesStartAt: true,
      seriesEndAt: true,
    },
    take: 200,
  });

  return res.json({ events });
});

authRouter.post('/goals', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const parsed = CreateGoalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const title = parsed.data.title.trim();
  if (!title) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const goal = await prismaAny.goal.create({
    data: {
      userId,
      title,
      progressPct: parsed.data.progressPct ?? 0,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    },
    select: { id: true, title: true, progressPct: true, dueAt: true, completed: true },
  });

  return res.status(201).json({ goal });
});

authRouter.get('/goals', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const goals = await prismaAny.goal.findMany({
    where: { userId },
    orderBy: [{ completed: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, progressPct: true, dueAt: true, completed: true },
    take: 200,
  });

  return res.json({ goals });
});

authRouter.put('/goals/:id', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const parsed = UpdateGoalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const id = String(req.params.id);
  const existing = await prismaAny.goal.findFirst({ where: { id, userId }, select: { id: true, title: true, completed: true } });
  if (!existing) {
    return res.status(404).json({ error: 'Not found' });
  }

  const data: any = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title.trim();
  if (parsed.data.progressPct !== undefined) data.progressPct = parsed.data.progressPct;
  if (parsed.data.dueAt !== undefined) data.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  if (parsed.data.completed !== undefined) data.completed = parsed.data.completed;

  if (data.title !== undefined && !data.title) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const willComplete = data.completed === true && existing.completed === false;
  const goal = await prismaAny.goal.update({
    where: { id },
    data,
    select: { id: true, title: true, progressPct: true, dueAt: true, completed: true },
  });

  if (willComplete) {
    const field = inferRankFieldFromText(existing.title);
    const scoreField = scoreFieldForRankField(field);
    await prismaAny.user.update({
      where: { id: userId },
      data: {
        score: { increment: 1 },
        [scoreField]: { increment: 1 },
      },
      select: { id: true },
    });
    await refreshLeaderboardTop(field);
  }

  return res.json({ goal });
});

authRouter.get('/leaderboard', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const fields: Array<'Sport' | 'Academy' | 'Entertainment'> = ['Sport', 'Academy', 'Entertainment'];

  await Promise.all(fields.map(f => refreshLeaderboardTop(f)));

  const leaderboards = await Promise.all(
    fields.map(async field => {
      const scoreField = scoreFieldForRankField(field);

      const top = await prismaAny.user.findMany({
        where: { [scoreField]: { gt: 0 } },
        orderBy: [{ [scoreField]: 'desc' }, { updatedAt: 'asc' }],
        select: { id: true, name: true, [scoreField]: true },
        take: 10,
      });

      const leaders = top.map((u: any, idx: number) => ({
        userId: String(u.id),
        name: u.name ?? 'Unknown',
        points: Number(u[scoreField] ?? 0),
        rank: idx + 1,
      }));

      const me = await prismaAny.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, [scoreField]: true },
      });

      const myPoints = Number(me?.[scoreField] ?? 0);
      const myRank =
        myPoints > 0
          ? (await prismaAny.user.count({
              where: { [scoreField]: { gt: myPoints } },
            })) + 1
          : null;

      const topRow = await prismaAny.leaderboardTop.findUnique({ where: { field } });

      return {
        field,
        topUser: topRow?.userName ?? (leaders[0]?.name ?? null),
        leaders,
        me: {
          userId,
          name: me?.name ?? 'You',
          points: myPoints,
          rank: myRank,
        },
      };
    })
  );

  return res.json({ leaderboards });
});

authRouter.get('/leaderboard/field', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const parsed = LeaderboardFieldQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query' });
  }

  const field = parsed.data.field;
  const limit = parsed.data.limit ?? 50;
  const offset = parsed.data.offset ?? 0;

  await refreshLeaderboardTop(field);

  const scoreField = scoreFieldForRankField(field);

  const total = await prismaAny.user.count({
    where: { [scoreField]: { gt: 0 } },
  });

  const rows = await prismaAny.user.findMany({
    where: { [scoreField]: { gt: 0 } },
    orderBy: [{ [scoreField]: 'desc' }, { updatedAt: 'asc' }],
    select: { id: true, name: true, [scoreField]: true },
    skip: offset,
    take: limit,
  });

  const leaders = rows.map((u: any, idx: number) => ({
    userId: String(u.id),
    name: u.name ?? 'Unknown',
    points: Number(u[scoreField] ?? 0),
    rank: offset + idx + 1,
  }));

  const me = await prismaAny.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, [scoreField]: true },
  });

  const myPoints = Number(me?.[scoreField] ?? 0);
  const myRank =
    myPoints > 0
      ? (await prismaAny.user.count({
          where: { [scoreField]: { gt: myPoints } },
        })) + 1
      : null;

  const topRow = await prismaAny.leaderboardTop.findUnique({ where: { field } });

  return res.json({
    field,
    topUser: topRow?.userName ?? (leaders[0]?.name ?? null),
    total,
    limit,
    offset,
    leaders,
    me: {
      userId,
      name: me?.name ?? 'You',
      points: myPoints,
      rank: myRank,
    },
  });
});

authRouter.delete('/goals/:id', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const id = String(req.params.id);
  const existing = await prismaAny.goal.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) {
    return res.status(404).json({ error: 'Not found' });
  }

  await prismaAny.goal.delete({ where: { id } });
  return res.json({ ok: true });
});

authRouter.post('/events', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const parsed = CreateEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const title = parsed.data.title.trim();
  if (!title) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const startAt = new Date(parsed.data.startAt);
  const endAt = parsed.data.endAt ? new Date(parsed.data.endAt) : null;
  const repeat = parsed.data.repeat ?? null;
  const seriesEndAt = parsed.data.seriesEndAt ? new Date(parsed.data.seriesEndAt) : null;

  if (seriesEndAt && seriesEndAt.getTime() < startAt.getTime()) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  if (isRepeating(repeat)) {
    const seriesId = randomUUID();
    const seriesStartAt = startAt;
    const seriesEndAtEffective = seriesEndAt ?? endAt ?? startAt;
    const durationMs = endAt ? endAt.getTime() - startAt.getTime() : 0;

    const eventsToCreate: any[] = [];
    let cursor = new Date(startAt);
    let guard = 0;
    while (cursor.getTime() <= seriesEndAtEffective.getTime()) {
      const occurrenceStart = new Date(cursor);
      const occurrenceEnd = endAt ? new Date(occurrenceStart.getTime() + durationMs) : null;
      eventsToCreate.push({
        userId,
        title,
        startAt: occurrenceStart,
        endAt: occurrenceEnd,
        repeat,
        seriesId,
        seriesStartAt,
        seriesEndAt: seriesEndAtEffective,
      });

      cursor = addRepeatInterval(cursor, repeat!);
      guard += 1;
      if (guard > 500) {
        break;
      }
    }

    if (eventsToCreate.length === 0) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    await prismaAny.event.createMany({ data: eventsToCreate });

    const first = await prismaAny.event.findFirst({
      where: { userId, seriesId },
      orderBy: [{ startAt: 'asc' }],
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        repeat: true,
        seriesId: true,
        seriesStartAt: true,
        seriesEndAt: true,
      },
    });

    return res.status(201).json({ event: first, createdCount: eventsToCreate.length });
  }

  const existing = await prismaAny.event.findFirst({
    where: {
      userId,
      title,
      startAt,
      endAt,
      repeat,
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      repeat: true,
      seriesId: true,
      seriesStartAt: true,
      seriesEndAt: true,
    },
  });

  if (existing) {
    return res.json({ event: existing });
  }

  const event = await prismaAny.event.create({
    data: {
      userId,
      title,
      startAt,
      endAt,
      repeat,
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      repeat: true,
      seriesId: true,
      seriesStartAt: true,
      seriesEndAt: true,
    },
  });

  return res.status(201).json({ event });
});

authRouter.put('/events/:id', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const parsed = UpdateEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const id = String(req.params.id);
  const existing = await prismaAny.event.findFirst({
    where: { id, userId },
    select: { id: true, title: true, startAt: true, endAt: true, repeat: true, seriesId: true },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Not found' });
  }

  const data: any = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title.trim();
  if (parsed.data.startAt !== undefined) data.startAt = new Date(parsed.data.startAt);
  if (parsed.data.endAt !== undefined) data.endAt = parsed.data.endAt ? new Date(parsed.data.endAt) : null;
  if (parsed.data.repeat !== undefined) data.repeat = parsed.data.repeat ?? null;

  if (data.title !== undefined && !data.title) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const scope = String((req.query as any).scope ?? '').trim().toLowerCase();
  if (!existing.seriesId && (scope === 'series' || scope === '' || scope === 'all')) {
    await ensureSeriesForLegacyRepeatingEvent({
      userId,
      event: {
        id: existing.id,
        title: existing.title,
        repeat: existing.repeat ?? null,
        startAt: new Date(existing.startAt),
        seriesId: existing.seriesId ?? null,
      },
    });
  }

  const existingAfter = await prismaAny.event.findFirst({
    where: { id, userId },
    select: { id: true, startAt: true, endAt: true, repeat: true, seriesId: true },
  });
  const seriesId = existingAfter?.seriesId ?? null;
  const shouldUpdateSeries = Boolean(seriesId) && (scope === 'series' || scope === '' || scope === 'all');

  if (shouldUpdateSeries) {
    const existingStartAt = new Date(existingAfter.startAt);
    const newStartAt = data.startAt ? new Date(data.startAt) : null;
    const deltaMs = newStartAt ? newStartAt.getTime() - existingStartAt.getTime() : 0;

    const patch: any = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.repeat !== undefined) patch.repeat = data.repeat;

    if (deltaMs !== 0 || data.endAt !== undefined) {
      const seriesEvents = await prismaAny.event.findMany({
        where: { userId, seriesId },
        select: { id: true, startAt: true, endAt: true },
      });

      await prismaAny.$transaction(
        seriesEvents.map((e: any) => {
          const nextStartAt = deltaMs !== 0 ? new Date(new Date(e.startAt).getTime() + deltaMs) : undefined;
          let nextEndAt: Date | null | undefined = undefined;
          if (data.endAt !== undefined) {
            if (!e.endAt || !existingAfter.endAt || !data.endAt) {
              nextEndAt = data.endAt ? new Date(data.endAt) : null;
            } else {
              const oldDurationMs = new Date(existingAfter.endAt).getTime() - new Date(existingAfter.startAt).getTime();
              const newDurationMs = new Date(data.endAt).getTime() - new Date(data.startAt ?? existing.startAt).getTime();
              const durationMs = Number.isFinite(newDurationMs) ? newDurationMs : oldDurationMs;
              nextEndAt = nextStartAt ? new Date(nextStartAt.getTime() + durationMs) : new Date(new Date(e.endAt).getTime() + deltaMs);
            }
          } else if (deltaMs !== 0) {
            nextEndAt = e.endAt ? new Date(new Date(e.endAt).getTime() + deltaMs) : null;
          }

          const perEventData: any = { ...patch };
          if (nextStartAt !== undefined) perEventData.startAt = nextStartAt;
          if (nextEndAt !== undefined) perEventData.endAt = nextEndAt;

          return prismaAny.event.update({ where: { id: e.id }, data: perEventData });
        })
      );
    } else {
      await prismaAny.event.updateMany({ where: { userId, seriesId }, data: patch });
    }

    const updated = await prismaAny.event.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        repeat: true,
        seriesId: true,
        seriesStartAt: true,
        seriesEndAt: true,
      },
    });
    return res.json({ event: updated });
  }

  const event = await prismaAny.event.update({
    where: { id },
    data,
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      repeat: true,
      seriesId: true,
      seriesStartAt: true,
      seriesEndAt: true,
    },
  });

  return res.json({ event });
});

authRouter.delete('/events', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const confirm = String((req.query as any).confirm ?? '');
  if (confirm !== 'YES_DELETE_MY_EVENTS') {
    return res.status(400).json({ error: 'Missing confirmation' });
  }

  const result = await prismaAny.event.deleteMany({ where: { userId } });
  return res.json({ ok: true, deletedCount: result.count });
});

authRouter.delete('/events/:id', async (req: Request, res: Response) => {
  const token = getAccessTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return res.status(401).json({ error: 'Invalid access token' });
  }

  const id = String(req.params.id);
  const existing = await prismaAny.event.findFirst({
    where: { id, userId },
    select: { id: true, title: true, repeat: true, startAt: true, seriesId: true },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Not found' });
  }

  const scope = String((req.query as any).scope ?? '').trim().toLowerCase();
  if (!existing.seriesId && (scope === 'series' || scope === '' || scope === 'all')) {
    await ensureSeriesForLegacyRepeatingEvent({
      userId,
      event: {
        id: existing.id,
        title: existing.title,
        repeat: existing.repeat ?? null,
        startAt: new Date(existing.startAt),
        seriesId: existing.seriesId ?? null,
      },
    });
  }

  const existingAfter = await prismaAny.event.findFirst({ where: { id, userId }, select: { id: true, seriesId: true } });
  const seriesId = existingAfter?.seriesId ?? null;
  const shouldDeleteSeries = Boolean(seriesId) && (scope === 'series' || scope === '' || scope === 'all');

  if (shouldDeleteSeries) {
    await prismaAny.event.deleteMany({ where: { userId, seriesId } });
    return res.json({ ok: true });
  }

  await prismaAny.event.delete({ where: { id } });
  return res.json({ ok: true });
});
