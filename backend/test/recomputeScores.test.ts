import assert from 'node:assert/strict';
import test from 'node:test';

import { authRouter } from '../src/routes/auth.ts';

test('recompute-scores is not an available route', () => {
  const routes = (authRouter.stack ?? [])
    .filter((layer: { route?: { path?: string; methods?: Record<string, boolean> } }) => layer.route)
    .map((layer: { route: { path: string; methods: Record<string, boolean> } }) => ({
      path: layer.route.path,
      post: layer.route.methods.post === true,
    }));
  assert.equal(routes.some(route => route.path === '/recompute-scores' && route.post), false);
});
