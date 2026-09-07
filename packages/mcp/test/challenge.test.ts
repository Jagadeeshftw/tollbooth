import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Challenge, RendererSet, TokenBearingRenderer } from '../src/challenge.js';
import { composeChallenge } from '../src/challenge.js';
import { COPY_VARIANTS, DEFAULT_COPY, resolveCopy } from '../src/copy.js';
import { negotiate } from '../src/negotiate.js';
import {
  createStructuredRenderer,
  createTextRenderer,
  inputRequiredRenderer,
  urlElicitationRenderer,
} from '../src/renderers.js';

const CHALLENGE: Challenge = {
  sku: 'search',
  toolName: 'lookup_market_data',
  amount: '10.00',
  currency: 'USDC',
  label: 'Search — 250 credits',
  checkoutUrl: 'https://www.moove.xyz/pay/pl_1',
  token: 'tb_s_abc123XYZ',
  argumentName: 'tollboothToken',
  reason: 'no_entitlement',
  expiresAt: 1_700_000_000_000,
};

describe('the two-channel renderer constraint', () => {
  it('types a user-only renderer as carrying no token', () => {
    assert.equal(urlElicitationRenderer.carriesToken, false);
    assert.equal(urlElicitationRenderer.render(CHALLENGE).modelChannel, null);
  });

  it('refuses a user-only renderer in the token-bearing slot', () => {
    // @ts-expect-error a UserOnlyRenderer cannot be a RendererSet's tokenBearer
    const bad: RendererSet = { tokenBearer: urlElicitationRenderer };
    // The runtime value exists; the point is that this line does not compile.
    assert.equal(bad.tokenBearer.carriesToken, false);
  });

  it('accepts a token-bearing renderer', () => {
    const good: RendererSet = { tokenBearer: createStructuredRenderer() };
    assert.equal(good.tokenBearer.carriesToken, true);
  });

  it('allows user-only renderers only as extras alongside a bearer', () => {
    const set: RendererSet = {
      tokenBearer: createTextRenderer(),
      userOnly: [urlElicitationRenderer],
    };
    const result = composeChallenge(set, CHALLENGE);
    assert.ok(result.content.length >= 2, 'the extra contributes to the user surface');
    assert.ok(
      result.content.some((c) => c.text.includes(CHALLENGE.token)),
      'the token still reaches the model via the bearer'
    );
  });
});

describe('shipped renderers carry the token', () => {
  for (const [name, renderer] of [
    ['text', createTextRenderer()],
    ['structured', createStructuredRenderer()],
  ] as [string, TokenBearingRenderer][]) {
    it(`${name} puts the token and the URL where the model can see them`, () => {
      const rendered = renderer.render(CHALLENGE);
      assert.equal(rendered.modelChannel.token, CHALLENGE.token);
      assert.equal(rendered.modelChannel.argumentName, 'tollboothToken');
      const text = rendered.content.map((c) => c.text).join('\n');
      assert.ok(text.includes(CHALLENGE.token), 'token is in the text the model reads');
      assert.ok(text.includes(CHALLENGE.checkoutUrl), 'URL is in the text the user reads');
      assert.equal(rendered.userChannel.url, CHALLENGE.checkoutUrl);
    });
  }

  it('structured adds a machine-readable payload naming the retry', () => {
    const rendered = createStructuredRenderer().render(CHALLENGE);
    const sc = rendered.structuredContent as Record<string, unknown>;
    assert.equal(sc['status'], 'payment_required');
    assert.deepEqual(sc['retry'], {
      tool: 'lookup_market_data',
      argument: 'tollboothToken',
      value: CHALLENGE.token,
    });
  });
});

describe('negotiation is deny-by-default', () => {
  const clients = [
    {},
    { name: 'claude-ai', version: '1.0' },
    { name: 'Claude Code', protocolVersion: '2025-11-25' },
    { name: 'cursor-vscode', protocolVersion: '2025-06-18' },
    { name: 'something-nobody-has-heard-of', protocolVersion: '2099-01-01' },
  ];

  for (const client of clients) {
    it(`gives ${client.name ?? 'an unnamed client'} a token-bearing renderer`, () => {
      const set = negotiate(client);
      assert.equal(set.tokenBearer.carriesToken, true);
      assert.equal(set.userOnly, undefined, 'nothing extra is enabled by default');
    });
  }

  it('never selects elicitation, whatever the client claims', () => {
    for (const client of clients) {
      const set = negotiate(client, { allow: ['url-elicitation', 'input-required'] });
      assert.ok(set.tokenBearer.carriesToken, 'the bearer always carries the token');
      assert.ok(!set.tokenBearer.id.startsWith('url-elicitation'));
    }
  });

  it('falls back to plain text on an unrecognised revision', () => {
    const set = negotiate({ protocolVersion: '2099-01-01' });
    assert.ok(set.tokenBearer.id.startsWith('text:'), 'text is the universal floor');
  });

  it('defaults to structured for known revisions', () => {
    assert.ok(negotiate({ protocolVersion: '2025-11-25' }).tokenBearer.id.startsWith('structured:'));
  });

  it('honours an explicit allow-list of shipped renderers', () => {
    const set = negotiate({ protocolVersion: '2025-11-25' }, { allow: ['text'] });
    assert.ok(set.tokenBearer.id.startsWith('text:'));
  });
});

describe('unregistered renderers', () => {
  it('input-required targets only the stateless revision', () => {
    assert.deepEqual(inputRequiredRenderer.revisions, ['2026-07-28']);
    assert.equal(inputRequiredRenderer.carriesToken, true, 'requestState can carry the token');
  });

  it('is not reachable through negotiation', () => {
    for (const revision of ['2025-11-25', '2026-07-28', undefined]) {
      const set = negotiate({ protocolVersion: revision }, { allow: ['input-required'] });
      assert.notEqual(set.tokenBearer.id, 'input-required');
    }
  });
});

describe('composed challenge result', () => {
  it('is an error result carrying the checkout in _meta', () => {
    const result = composeChallenge({ tokenBearer: createStructuredRenderer() }, CHALLENGE);
    assert.equal(result.isError, true);
    const meta = result._meta?.['xyz.tollbooth/challenge'] as Record<string, unknown>;
    assert.equal(meta['checkoutUrl'], CHALLENGE.checkoutUrl);
    assert.equal(meta['argumentName'], 'tollboothToken');
    assert.equal(meta['amount'], '10.00');
  });
});

describe('challenge copy', () => {
  it('ships v3', () => {
    assert.equal(DEFAULT_COPY.id, 'v3');
  });

  it('every variant names the URL, the token and the argument', () => {
    for (const [id, variant] of Object.entries(COPY_VARIANTS)) {
      const text = variant.render(CHALLENGE);
      assert.ok(text.includes(CHALLENGE.checkoutUrl), `${id} must show the URL`);
      assert.ok(text.includes(CHALLENGE.token), `${id} must show the token`);
      assert.ok(text.includes('tollboothToken'), `${id} must name the argument`);
    }
  });

  it('records the evidence behind each variant', () => {
    for (const [id, variant] of Object.entries(COPY_VARIANTS)) {
      assert.ok(variant.evidence, `${id} must carry its measurement`);
      assert.ok(variant.evidence!.trials > 0);
      assert.ok(variant.evidence!.retried <= variant.evidence!.trials);
    }
  });

  it('rejects an unknown variant by name', () => {
    assert.throws(() => resolveCopy('v99'), /unknown challenge copy/);
  });
});
