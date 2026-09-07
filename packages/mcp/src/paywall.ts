import { mayUseSubject } from '@tollbooth/core';
import type {
  Charge,
  EntitlementStore,
  PaymentProvider,
  SettlementOutcome,
  Sku,
  SubjectRecord,
} from '@tollbooth/core';
import { z } from 'zod';

import type { Challenge, ChallengeResult, RendererSet } from './challenge.js';
import { composeChallenge } from './challenge.js';
import { DEFAULT_COPY } from './copy.js';
import { negotiate } from './negotiate.js';
import type { ClientProfile } from './negotiate.js';

/** The tool argument the agent carries the handle back in. */
export const DEFAULT_ARGUMENT_NAME = 'tollboothToken';

export interface PaywallConfig {
  provider: PaymentProvider;
  /** Where credits are spent from. Passed explicitly rather than reached for. */
  store: EntitlementStore;
  /** Defaults to {@link DEFAULT_ARGUMENT_NAME}. */
  argumentName?: string;
  /** Challenge copy variant. Defaults to the shipped v3. */
  copyId?: string;
  /** Renderer ids permitted beyond the default. Deny-by-default otherwise. */
  allow?: readonly string[];
  /** Called on every settlement observation. Use it to log or alert. */
  onSettlement?: (outcome: SettlementOutcome) => void;
  now?: () => number;
}

export interface PaidToolPricing {
  sku: Sku;
  /** Credits this call costs. Defaults to 1. */
  cost?: number;
}

/**
 * Minimal shape of the MCP server we augment.
 *
 * `registerTool` on the real SDK is an overloaded generic whose parameter types
 * are inferred from the caller's Zod shape. Pinning them here would make
 * `McpServer` fail the constraint and collapse the wrapper's return type to
 * this interface, losing `connect` and everything else. The two loose
 * parameters are deliberate, and confined to this one declaration — what we
 * actually pass is built and typed inside `withPaywall`.
 */
export interface RegisterableServer {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  registerTool(name: string, config: any, handler: any): any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** The config we build for `registerTool`, typed on our side of the boundary. */
interface ToolRegistration {
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations: Record<string, unknown>;
}

export type PaywalledServer<S extends RegisterableServer> = S & {
  /**
   * Register a tool that requires payment.
   *
   * Argument order mirrors Cloudflare Agents' `paidTool` so the shape is
   * familiar to anyone who has monetised an MCP server before.
   */
  paidTool(
    name: string,
    description: string,
    pricing: Sku | PaidToolPricing,
    inputSchema: Record<string, z.ZodTypeAny>,
    annotations: Record<string, unknown>,
    handler: (args: Record<string, unknown>, extra: unknown) => unknown
  ): unknown;
};

/**
 * Wrap an MCP server so that tools registered with `paidTool` are gated behind
 * a payment, and everything else keeps working untouched.
 */
export function withPaywall<S extends RegisterableServer>(
  server: S,
  config: PaywallConfig
): PaywalledServer<S> {
  const argumentName = config.argumentName ?? DEFAULT_ARGUMENT_NAME;
  const now = config.now ?? Date.now;
  const gate = new Paywall(config, argumentName, now);

  const augmented = server as PaywalledServer<S>;

  augmented.paidTool = (name, description, pricing, inputSchema, annotations, handler) => {
    const { sku, cost } = normalisePricing(pricing);
    const price = config.provider.priceFor(sku);
    if (!price) {
      throw new Error(
        `paidTool ${JSON.stringify(name)} references sku ${JSON.stringify(sku)}, which the ` +
          'provider does not sell. Register the price before the tool.'
      );
    }

    const registration: ToolRegistration = {
      description,
      inputSchema: {
        ...inputSchema,
        [argumentName]: z
          .string()
          .optional()
          .describe(
            'Opaque payment handle. Omit on the first call. If the call returns ' +
              'PAYMENT_REQUIRED, pass the exact handle from that response here after ' +
              'the user has paid.'
          ),
      },
      annotations: { ...annotations, 'xyz.tollbooth/paid': true, 'xyz.tollbooth/sku': sku },
    };

    return server.registerTool(
      name,
      registration,
      async (args: Record<string, unknown>, extra: unknown) => {
        const token = typeof args[argumentName] === 'string' ? (args[argumentName] as string) : undefined;
        const rest = { ...args };
        delete rest[argumentName];

        const decision = await gate.authorise({
          sku,
          cost,
          toolName: name,
          token,
          client: clientProfileFrom(extra),
          principal: principalFrom(extra),
        });

        if (!decision.ok) return decision.result;
        return handler(rest, extra);
      }
    );
  };

  return augmented;
}

function normalisePricing(p: Sku | PaidToolPricing): { sku: Sku; cost: number } {
  if (typeof p === 'string') return { sku: p, cost: 1 };
  return { sku: p.sku, cost: p.cost ?? 1 };
}

/** The gate. Separated from registration so it can be tested on its own. */
export class Paywall {
  readonly #config: PaywallConfig;
  readonly #argumentName: string;
  readonly #now: () => number;

  constructor(config: PaywallConfig, argumentName: string, now: () => number) {
    this.#config = config;
    this.#argumentName = argumentName;
    this.#now = now;
  }

  async authorise(args: {
    sku: Sku;
    cost: number;
    toolName: string;
    token: string | undefined;
    client?: ClientProfile;
    principal?: string | null;
  }): Promise<{ ok: true } | { ok: false; result: ChallengeResult }> {
    const { provider } = this.#config;

    // No handle: this is a first call. Mint one and open a charge.
    if (!args.token) {
      const record = await provider.issueSubject(args.principal ?? null);
      return { ok: false, result: await this.#challenge(record.subject, args) };
    }

    const record = await this.#loadSubject(args.token, args.principal ?? null);
    if (!record) {
      // Unknown or lapsed handle. Start again rather than failing hard: the
      // caller is trying to pay, and a dead handle is not their fault.
      const fresh = await provider.issueSubject(args.principal ?? null);
      return { ok: false, result: await this.#challenge(fresh.subject, args) };
    }

    const spent = await this.#spend(record.subject, args);
    if (spent) {
      await provider.touchSubject(record.subject);
      return { ok: true };
    }

    return { ok: false, result: await this.#challenge(record.subject, args) };
  }

  /**
   * Resolve a presented handle. Returns undefined when it is unknown, lapsed,
   * or bound to a different principal.
   */
  async #loadSubject(token: string, principal: string | null): Promise<SubjectRecord | undefined> {
    const record = await this.#config.provider.getSubjectRecord(token);
    if (!record) return undefined;
    return mayUseSubject(record, this.#now(), principal) ? record : undefined;
  }

  /** Try to spend a credit, settling any pending charge first if needed. */
  async #spend(subject: string, args: { sku: Sku; cost: number }): Promise<boolean> {
    const first = await this.#config.store.consume(subject, args.sku, args.cost);
    if (first.ok) return true;

    // No credit yet. If this caller has a charge outstanding, the retry we are
    // serving is very likely the one that follows their payment, so check.
    const pending = await this.#pendingChargeFor(subject, args.sku);
    if (!pending) return false;

    const outcome = await this.#config.provider.settleCharge(pending.nonce);
    this.#config.onSettlement?.(outcome);
    if (outcome.status !== 'granted' && outcome.status !== 'partial') return false;

    const second = await this.#config.store.consume(subject, args.sku, args.cost);
    return second.ok;
  }

  async #pendingChargeFor(subject: string, sku: Sku): Promise<Charge | undefined> {
    const pending = await this.#config.store.pendingCharges();
    return pending
      .filter((c) => c.subject === subject && c.sku === sku)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  async #challenge(
    subject: string,
    args: { sku: Sku; toolName: string; client?: ClientProfile }
  ): Promise<ChallengeResult> {
    const { provider } = this.#config;
    const price = provider.priceFor(args.sku);
    if (!price) throw new Error(`no price registered for sku ${JSON.stringify(args.sku)}`);

    // Reuse an outstanding charge so a retry keeps the same link and handle
    // rather than opening a second checkout for the same purchase.
    const existing = await this.#pendingChargeFor(subject, args.sku);
    const { charge, checkoutUrl } =
      existing && existing.checkoutUrl
        ? { charge: existing, checkoutUrl: existing.checkoutUrl }
        : await provider.openCharge({ sku: args.sku, subject, toolName: args.toolName });

    const challenge: Challenge = {
      sku: args.sku,
      toolName: args.toolName,
      amount: price.amount,
      currency: price.currency,
      label: price.label,
      checkoutUrl,
      token: subject,
      argumentName: this.#argumentName,
      reason: 'no_entitlement',
      expiresAt: charge.expiresAt,
    };

    const set: RendererSet = negotiate(args.client ?? {}, {
      copyId: this.#config.copyId ?? DEFAULT_COPY.id,
      ...(this.#config.allow ? { allow: this.#config.allow } : {}),
    });
    return composeChallenge(set, challenge);
  }
}

function clientProfileFrom(extra: unknown): ClientProfile {
  const e = extra as { clientInfo?: { name?: string; version?: string }; protocolVersion?: string };
  return {
    name: e?.clientInfo?.name,
    version: e?.clientInfo?.version,
    protocolVersion: e?.protocolVersion,
  };
}

function principalFrom(extra: unknown): string | null {
  const e = extra as { authInfo?: { clientId?: string; sub?: string } };
  return e?.authInfo?.sub ?? e?.authInfo?.clientId ?? null;
}
