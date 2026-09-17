import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getTenant, upsertTenantForGithubUser } from '../src/tenants.js';
import { CONNECTION_STRING, freshDatabase } from './helpers.js';

if (!CONNECTION_STRING) {
  describe('tenants', () => {
    it('needs TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL (never DATABASE_URL - this suite truncates)', { skip: 'no connection string' }, () => {});
  });
} else {
  describe('upsertTenantForGithubUser', () => {
    it('creates a tenant on first sign-in', async () => {
      const db = await freshDatabase();
      try {
        const tenant = await upsertTenantForGithubUser(db, { id: 42, login: 'octocat', name: null, avatarUrl: null });
        assert.match(tenant.id, /^tb_t_/);
        assert.equal(tenant.githubUserId, 42);
        assert.equal(tenant.githubLogin, 'octocat');
      } finally {
        await db.close();
      }
    });

    it('returns the same tenant on a second sign-in, never creating a duplicate', async () => {
      const db = await freshDatabase();
      try {
        const first = await upsertTenantForGithubUser(db, { id: 42, login: 'octocat', name: null, avatarUrl: null });
        const second = await upsertTenantForGithubUser(db, { id: 42, login: 'octocat', name: null, avatarUrl: null });
        assert.equal(first.id, second.id);
        assert.equal(first.createdAt, second.createdAt);
      } finally {
        await db.close();
      }
    });

    it('keeps the login current after a GitHub rename', async () => {
      const db = await freshDatabase();
      try {
        const first = await upsertTenantForGithubUser(db, { id: 42, login: 'octocat', name: null, avatarUrl: null });
        const renamed = await upsertTenantForGithubUser(db, { id: 42, login: 'octocat-renamed', name: null, avatarUrl: null });
        assert.equal(renamed.id, first.id);
        assert.equal(renamed.githubLogin, 'octocat-renamed');
        assert.equal((await getTenant(db, first.id))?.githubLogin, 'octocat-renamed');
      } finally {
        await db.close();
      }
    });

    it('two different GitHub users get two different tenants', async () => {
      const db = await freshDatabase();
      try {
        const a = await upsertTenantForGithubUser(db, { id: 1, login: 'a', name: null, avatarUrl: null });
        const b = await upsertTenantForGithubUser(db, { id: 2, login: 'b', name: null, avatarUrl: null });
        assert.notEqual(a.id, b.id);
      } finally {
        await db.close();
      }
    });
  });

  describe('getTenant', () => {
    it('returns undefined for an id nobody has', async () => {
      const db = await freshDatabase();
      try {
        assert.equal(await getTenant(db, 'tb_t_nobody'), undefined);
      } finally {
        await db.close();
      }
    });
  });
}
