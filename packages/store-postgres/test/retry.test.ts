import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AmbiguousCommitError, isRetryableConnectionError } from '../src/index.js';

describe('which failures are worth retrying', () => {
  it('retries the connection-level errors Neon produces when a branch wakes', () => {
    for (const error of [
      { code: '57P03' }, // cannot_connect_now, i.e. cold start
      { code: '57P01' }, // admin_shutdown
      { code: '08006' }, // connection_failure
      { code: '53300' }, // too_many_connections
      { code: 'ECONNRESET' },
      { code: 'ETIMEDOUT' },
      { message: 'Connection terminated unexpectedly' },
      { message: 'socket hang up' },
      { message: 'Client has encountered a connection error and is not queryable' },
      { message: 'terminating connection due to administrator command' },
    ]) {
      assert.equal(isRetryableConnectionError(error), true, JSON.stringify(error));
    }
  });

  it('never retries an error the request itself caused', () => {
    for (const error of [
      { code: '23505', message: 'duplicate key value violates unique constraint' },
      { code: '42P01', message: 'relation does not exist' },
      { code: '42601', message: 'syntax error' },
      { code: '23502', message: 'null value violates not-null constraint' },
      { code: '22P02', message: 'invalid input syntax' },
      new Error('something else entirely'),
      undefined,
      null,
    ]) {
      assert.equal(isRetryableConnectionError(error), false, JSON.stringify(error));
    }
  });

  it('a failed COMMIT is never retried, because it may have applied', () => {
    const e = new AmbiguousCommitError(new Error('Connection terminated unexpectedly'));
    // It carries a retryable-looking cause, and is still not retryable itself:
    // retrying could spend the same credit twice.
    assert.equal(isRetryableConnectionError(e.cause), true, 'the cause looks transient');
    assert.match(e.message, /could spend the same credit twice/);
    assert.equal(e.name, 'AmbiguousCommitError');
  });
});
