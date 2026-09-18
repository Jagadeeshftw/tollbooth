import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mintIngestToken } from '../src/ids.js';
import { upsertTenantForGithubUser } from '../src/tenants.js';
import {
  authenticateIngestToken,
  issueTenantIngestToken,
  listTenantIngestTokens,
  revokeIngestToken,
} from '../src/tokens.js';
import { CONNECTION_STRING, freshDatabase } from './helpers.js';

if (!CONNECTION_STRING) {
  describe('tokens', () => {
    it('needs TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL (never DATABASE_URL - this suite truncates)', { skip: 'no connection string' }, () => {});
  });
} else {
  async function tenant(db: Awaited<ReturnType<typeof freshDatabase>>) {
    return upsertTenantForGithubUser(db, { id: 1, login: 'tenant-a', name: null, avatarUrl: null });
  }

  async function otherTenant(db: Awaited<ReturnType<typeof freshDatabase>>) {
    return upsertTenantForGithubUser(db, { id: 2, login: 'tenant-b', name: null, avatarUrl: null });
  }

  describe('issueTenantIngestToken and authenticateIngestToken', () => {
    it('a freshly issued token authenticates to its own tenant', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const { token } = await issueTenantIngestToken(db, t.id);
        const auth = await authenticateIngestToken(db, token);
        assert.equal(auth?.tenantId, t.id);
      } finally {
        await db.close();
      }
    });

    it('rejects a token nobody issued', async () => {
      const db = await freshDatabase();
      try {
        assert.equal(await authenticateIngestToken(db, mintIngestToken()), null);
      } finally {
        await db.close();
      }
    });

    it('rejects a revoked token', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const { token, record } = await issueTenantIngestToken(db, t.id);
        assert.notEqual(await authenticateIngestToken(db, token), null);
        assert.equal(await revokeIngestToken(db, t.id, record.id), true);
        assert.equal(await authenticateIngestToken(db, token), null);
      } finally {
        await db.close();
      }
    });

    it('records last-used-at only on a successful authentication', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const { token, record } = await issueTenantIngestToken(db, t.id);
        const before = await listTenantIngestTokens(db, t.id);
        assert.equal(before.find((r) => r.id === record.id)?.lastUsedAt, null);

        await authenticateIngestToken(db, token, () => 5000);
        const after = await listTenantIngestTokens(db, t.id);
        assert.equal(after.find((r) => r.id === record.id)?.lastUsedAt, 5000);
      } finally {
        await db.close();
      }
    });

    it('one tenant can hold several tokens, each independently valid', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const first = await issueTenantIngestToken(db, t.id);
        const second = await issueTenantIngestToken(db, t.id);
        assert.equal((await authenticateIngestToken(db, first.token))?.tenantId, t.id);
        assert.equal((await authenticateIngestToken(db, second.token))?.tenantId, t.id);
        assert.equal((await listTenantIngestTokens(db, t.id)).length, 2);
      } finally {
        await db.close();
      }
    });
  });

  describe('revokeIngestToken', () => {
    it('refuses to revoke a token belonging to a different tenant', async () => {
      const db = await freshDatabase();
      try {
        const a = await tenant(db);
        const b = await otherTenant(db);
        const { token, record } = await issueTenantIngestToken(db, a.id);

        assert.equal(await revokeIngestToken(db, b.id, record.id), false);
        assert.notEqual(await authenticateIngestToken(db, token), null, 'a stranger tenant cannot revoke it');

        assert.equal(await revokeIngestToken(db, a.id, record.id), true);
        assert.equal(await authenticateIngestToken(db, token), null);
      } finally {
        await db.close();
      }
    });

    it('reports false, not an error, for an id that never existed', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        assert.equal(await revokeIngestToken(db, t.id, 'tbgw_id_nonexistent'), false);
      } finally {
        await db.close();
      }
    });
  });
}
