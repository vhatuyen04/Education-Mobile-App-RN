import bcrypt from 'bcrypt';
import { Request, Response, Router } from 'express';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';

import { prisma } from '../utils/prisma.js';
import { getConfig } from '../utils/config.js';

export const authRouter = Router();

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

authRouter.post('/register', async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
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
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
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
