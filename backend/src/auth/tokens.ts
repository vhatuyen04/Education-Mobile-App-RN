import { createHash } from 'node:crypto';

import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';

import { getConfig } from '../utils/config.js';

export type AccessRole = 'USER' | 'ADMIN';

export function signAccessToken(userId: string, role: AccessRole) {
  const config = getConfig();
  const options: SignOptions = { expiresIn: config.accessTokenTtl as SignOptions['expiresIn'] };
  return jwt.sign({ sub: userId, type: 'access', role }, config.jwtAccessSecret as Secret, options);
}

export function signRefreshToken(userId: string) {
  const config = getConfig();
  const options: SignOptions = { expiresIn: config.refreshTokenTtl as SignOptions['expiresIn'] };
  return jwt.sign({ sub: userId, type: 'refresh' }, config.jwtRefreshSecret as Secret, options);
}

export function verifyAccessToken(token: string): { sub: string; role: AccessRole } {
  const config = getConfig();
  const payload: any = jwt.verify(token, config.jwtAccessSecret);
  if (!payload?.sub || payload?.type !== 'access') {
    throw new Error('Invalid token');
  }
  const role: AccessRole = payload?.role === 'ADMIN' ? 'ADMIN' : 'USER';
  return { sub: String(payload.sub), role };
}

export function verifyRefreshToken(token: string): { sub: string } {
  const config = getConfig();
  const payload: any = jwt.verify(token, config.jwtRefreshSecret);
  if (!payload?.sub || payload?.type !== 'refresh') {
    throw new Error('Invalid token');
  }
  return { sub: String(payload.sub) };
}

export function refreshTokenMaterial(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export async function assertStoredRefreshToken(
  token: string,
  refreshTokenHash: string | null,
  compare: (plain: string, hash: string) => Promise<boolean>
) {
  const verified = verifyRefreshToken(token);
  if (!refreshTokenHash) {
    throw new Error('Revoked refresh token');
  }
  const matches = await compare(refreshTokenMaterial(token), refreshTokenHash);
  if (!matches) {
    throw new Error('Revoked refresh token');
  }
  return verified;
}

export async function writeRefreshHashIfUnchanged(
  updateMany: (args: {
    where: { id: string; refreshTokenHash: string };
    data: { refreshTokenHash: string | null };
  }) => Promise<{ count: number }>,
  userId: string,
  presentedHash: string,
  nextHash: string | null
): Promise<boolean> {
  const result = await updateMany({
    where: { id: userId, refreshTokenHash: presentedHash },
    data: { refreshTokenHash: nextHash },
  });
  return result.count === 1;
}
