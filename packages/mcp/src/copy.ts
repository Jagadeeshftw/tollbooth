import type { Challenge } from './challenge.js';

/**
 * Challenge copy is a tuned asset, not a string constant.
 *
 * It is the only component here whose correctness is statistical: whether the
 * loop closes depends on the model deciding to retry, and that decision is
 * driven by wording. Each variant below records what was measured, so a change
 * can be argued against evidence rather than taste.
 *
 * Read `harness/README.md` for how the numbers were produced, and treat the
 * differences *between* passing variants as noise: at five trials each, the
 * gap between 5/5 and 4/5 is not a real effect.
 */

export interface CopyVariant {
  readonly id: string;
  /** One line on what this variant is trying to do differently. */
  readonly intent: string;
  readonly evidence: CopyEvidence | null;
  render(challenge: Challenge): string;
}

export interface CopyEvidence {
  /** Blind two-turn trials against real Claude Code instances. */
  readonly trials: number;
  readonly retried: number;
  readonly tokenExact: number;
  readonly measuredOn: string;
  readonly notes?: string;
}

const UNDERPOWERED =
  'Five trials. The gap to other passing variants is not statistically meaningful.';

function head(c: Challenge): string {
  return `Payment required: ${c.amount} ${c.currency} for ${c.label}.`;
}

/** Bare facts. The control, and it performed as well as anything else. */
export const v1: CopyVariant = {
  id: 'v1',
  intent: 'Control: URL and token, no instruction.',
  evidence: { trials: 5, retried: 5, tokenExact: 5, measuredOn: '2026-09-07', notes: UNDERPOWERED },
  render: (c) => `${head(c)}\nPay here: ${c.checkoutUrl}\n${c.argumentName}: ${c.token}`,
};

/** Adds an explicit retry instruction. */
export const v2: CopyVariant = {
  id: 'v2',
  intent: 'Imperative: name the retry and the argument.',
  evidence: { trials: 5, retried: 5, tokenExact: 5, measuredOn: '2026-09-07', notes: UNDERPOWERED },
  render: (c) =>
    `PAYMENT_REQUIRED\n\n${head(c)}\n\n` +
    `Ask the user to open this link and pay:\n${c.checkoutUrl}\n\n` +
    `When the user confirms they have paid, call this same tool again with the ` +
    `identical arguments plus ${c.argumentName}="${c.token}".\n` +
    `Do not modify the token. Do not create a new one.`,
};

/**
 * v2 plus guards against the two competing behaviours actually observed:
 * answering from the model's own knowledge, and reporting the challenge as a
 * failure and stopping. **This is the shipped default.**
 */
export const v3: CopyVariant = {
  id: 'v3',
  intent: 'Imperative plus guards against answering from memory or abandoning.',
  evidence: {
    trials: 13,
    retried: 13,
    tokenExact: 13,
    measuredOn: '2026-09-07',
    notes: 'Five trials on text carrier plus eight on a higher-N confirmation run.',
  },
  render: (c) =>
    `PAYMENT_REQUIRED\n\n${head(c)}\n\n` +
    `NEXT STEP — show the user this link and ask them to pay:\n${c.checkoutUrl}\n\n` +
    `AFTER the user says they have paid, retry:\n` +
    `  same tool, same arguments, plus ${c.argumentName}="${c.token}"\n\n` +
    `Rules:\n` +
    `- Copy ${c.argumentName} exactly. It is opaque; any edit invalidates it.\n` +
    `- Do NOT answer the user's question from your own knowledge instead.\n` +
    `- Do NOT stop and summarise. The task is not finished until you retry.\n` +
    `- This is not an error you should report and abandon.`,
};

/** Reframes the challenge as step 1 of 2 rather than a failure. */
export const v4: CopyVariant = {
  id: 'v4',
  intent: 'Two-step framing: test whether "error" framing itself causes abandonment.',
  evidence: {
    trials: 5,
    retried: 4,
    tokenExact: 4,
    measuredOn: '2026-09-07',
    notes: 'One refusal. ' + UNDERPOWERED,
  },
  render: (c) =>
    `This tool runs in two steps. Step 1 of 2 complete.\n\n` +
    `${head(c)}\n\n` +
    `STEP 2 (you must do this):\n` +
    `  a. Show the user this payment link and ask them to complete it:\n     ${c.checkoutUrl}\n` +
    `  b. Wait for the user to confirm payment.\n` +
    `  c. Call this same tool again with the same arguments and add:\n` +
    `     ${c.argumentName}="${c.token}"\n\n` +
    `The token is an opaque receipt handle — reproduce it character for character.`,
};

/** v4 plus a literal ready-to-copy call. The most insistent variant. */
export const v5: CopyVariant = {
  id: 'v5',
  intent: 'Maximally explicit, including a literal call to copy.',
  evidence: {
    trials: 5,
    retried: 4,
    tokenExact: 4,
    measuredOn: '2026-09-07',
    notes:
      'One refusal in which the model cited "the tool\'s insistence on payment plus ' +
      'pressure" as grounds for suspicion. ' + UNDERPOWERED,
  },
  render: (c) =>
    `This tool runs in two steps. Step 1 of 2 complete — payment is needed to continue.\n\n` +
    `${head(c)}\n\nShow the user this link and ask them to pay:\n${c.checkoutUrl}\n\n` +
    `Once the user confirms payment, make exactly this call:\n` +
    `  ${c.toolName}({ ...same arguments..., ${c.argumentName}: "${c.token}" })\n\n` +
    `Notes:\n` +
    `- ${c.argumentName} is opaque. Copy it exactly; do not shorten or invent one.\n` +
    `- Do not answer from your own knowledge; the paid data differs from what you know.\n` +
    `- Do not abandon the task. Retrying after payment is the expected path.`,
};

export const COPY_VARIANTS: Record<string, CopyVariant> = { v1, v2, v3, v4, v5 };

/**
 * The shipped default.
 *
 * v1 and v2 measured identically, and the honest reading is that any variant
 * which states the URL, the token and the retry works. v3 is chosen because
 * its extra guards address behaviours that were actually observed, while
 * stopping short of the insistence that drew a refusal in v5.
 */
export const DEFAULT_COPY = v3;

export function resolveCopy(id: string = DEFAULT_COPY.id): CopyVariant {
  const variant = COPY_VARIANTS[id];
  if (!variant) {
    throw new Error(
      `unknown challenge copy ${JSON.stringify(id)}; known variants: ` +
        Object.keys(COPY_VARIANTS).join(', ')
    );
  }
  return variant;
}
