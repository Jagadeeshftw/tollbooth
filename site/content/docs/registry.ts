import type { ComponentType } from "react";

import * as overview from "./pages/overview";
import * as howItWorks from "./pages/how-it-works";
import * as quickstart from "./pages/quickstart";
import * as pricingUnits from "./pages/pricing-units";
import * as configuration from "./pages/configuration";
import * as stores from "./pages/stores";
import * as mooveSetup from "./pages/moove-setup";
import * as linkIds from "./pages/link-ids";
import * as clients from "./pages/clients";
import * as results from "./pages/results";
import * as rateLimits from "./pages/rate-limits";
import * as underpayment from "./pages/underpayment";
import * as security from "./pages/security";
import * as troubleshooting from "./pages/troubleshooting";

export type Toc = { id: string; text: string };

export type DocMeta = {
  slug: string;
  title: string;
  summary: string;
  section: string;
  toc: Toc[];
};

export type DocPage = DocMeta & { Component: ComponentType };

type Module = { meta: DocMeta; default: ComponentType };

/** Reading order. The sidebar groups by `section`; prev/next follows this list. */
const MODULES: Module[] = [
  overview,
  howItWorks,
  quickstart,
  pricingUnits,
  configuration,
  stores,
  mooveSetup,
  linkIds,
  clients,
  results,
  rateLimits,
  underpayment,
  security,
  troubleshooting,
];

export const DOCS: DocPage[] = MODULES.map((m) => ({ ...m.meta, Component: m.default }));

/** Serialisable for the client sidebar: no components. */
export const DOC_META: DocMeta[] = DOCS.map(({ Component: _c, ...meta }) => meta);

export const getDoc = (slug: string): DocPage | undefined => DOCS.find((d) => d.slug === slug);
