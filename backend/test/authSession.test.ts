import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import {
  assertStoredRefreshToken,
  refreshTokenMaterial,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  writeRefreshHashIfUnchanged,
} from '../src/auth/tokens.ts';
import { getConfig } from '../src/utils/config.ts';

const user = { id: 'user-1', role: 'USER' as const };

test('accepts a valid access token', () => {
  const token = signAccessToken(user.id, user.role);
  const verified = verifyAccessToken(token);
  assert.equal(verified.sub, user.id);
  assert.equal(verified.role, 'USER');
});

test('rejects an expired access token and accepts a valid refresh token', async () => {
  const config = getConfig();
  const expired = jwt.sign(
    { sub: user.id, type: 'access', role: 'USER', exp: Math.floor(Date.now() / 1000) - 60 },
    config.jwtAccessSecret
  );
  assert.throws(() => verifyAccessToken(expired), /jwt expired/);

  const refresh = signRefreshToken(user.id);
  assert.equal(verifyRefreshToken(refresh).sub, user.id);
});

test('rejects an expired refresh token', () => {
  const config = getConfig();
  const expired = jwt.sign(
    { sub: user.id, type: 'refresh', exp: Math.floor(Date.now() / 1000) - 60 },
    config.jwtRefreshSecret
  );
  assert.throws(() => verifyRefreshToken(expired), /jwt expired/);
});

test('rejects a refresh token revoked by logout', async () => {
  const refresh = signRefreshToken(user.id);
  const hash = await bcrypt.hash(refreshTokenMaterial(refresh), 4);
  await assert.rejects(assertStoredRefreshToken(refresh, null, bcrypt.compare), /Revoked refresh token/);
  assert.equal((await assertStoredRefreshToken(refresh, hash, bcrypt.compare)).sub, user.id);
});

test('rejects the previous refresh token after rotation', async () => {
  const config = getConfig();
  const previous = jwt.sign({ sub: user.id, type: 'refresh', jti: 'previous' }, config.jwtRefreshSecret, { expiresIn: '30d' });
  const current = jwt.sign({ sub: user.id, type: 'refresh', jti: 'current' }, config.jwtRefreshSecret, { expiresIn: '30d' });
  assert.notEqual(previous, current);
  assert.equal(previous.slice(0, 72), current.slice(0, 72));
  assert.notEqual(refreshTokenMaterial(previous), refreshTokenMaterial(current));
  const hash = await bcrypt.hash(refreshTokenMaterial(current), 4);
  await assert.rejects(assertStoredRefreshToken(previous, hash, bcrypt.compare), /Revoked refresh token/);
  assert.equal((await assertStoredRefreshToken(current, hash, bcrypt.compare)).sub, user.id);
});

test('one of two concurrent refresh claims wins, and a stale logout cannot revoke it', async () => {
  const row: { refreshTokenHash: string | null } = { refreshTokenHash: 'hash-current' };
  const updateMany = async (args: {
    where: { id: string; refreshTokenHash: string };
    data: { refreshTokenHash: string | null };
  }) => {
    if (row.refreshTokenHash !== args.where.refreshTokenHash) return { count: 0 };
    row.refreshTokenHash = args.data.refreshTokenHash;
    return { count: 1 };
  };

  const [first, second] = await Promise.all([
    writeRefreshHashIfUnchanged(updateMany, user.id, 'hash-current', 'hash-a'),
    writeRefreshHashIfUnchanged(updateMany, user.id, 'hash-current', 'hash-b'),
  ]);
  assert.equal(Number(first) + Number(second), 1);
  const winner = row.refreshTokenHash;
  assert.ok(winner === 'hash-a' || winner === 'hash-b');

  const staleLogout = await writeRefreshHashIfUnchanged(updateMany, user.id, 'hash-current', null);
  assert.equal(staleLogout, false);
  assert.equal(row.refreshTokenHash, winner);

  const [rotated, loggedOut] = await Promise.all([
    writeRefreshHashIfUnchanged(updateMany, user.id, winner, 'hash-next'),
    writeRefreshHashIfUnchanged(updateMany, user.id, winner, null),
  ]);
  assert.equal(Number(rotated) + Number(loggedOut), 1);
  if (rotated) assert.equal(row.refreshTokenHash, 'hash-next');
  if (loggedOut) assert.equal(row.refreshTokenHash, null);
});

test('rejects an invalid or tampered JWT', () => {
  const token = signAccessToken(user.id, user.role);
  const tampered = `${token.slice(0, -2)}aa`;
  assert.throws(() => verifyAccessToken(tampered));
  assert.throws(() => verifyRefreshToken(token));
  const config = getConfig();
  const wrongType = jwt.sign({ sub: user.id, type: 'access' }, config.jwtRefreshSecret);
  assert.throws(() => verifyRefreshToken(wrongType), /Invalid token/);
});
