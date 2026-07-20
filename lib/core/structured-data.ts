// Structured data extractors: JSON-LD, OpenGraph/Twitter, Microdata and
// framework internal state (__NEXT_DATA__ / __NUXT__ / __INITIAL_STATE__).
// Ported from Rev-032v2 prototype (Sections 18-19).

import { cleanInline, maskPii } from './utils';
import type { ResolvedConfig } from '../types';

export const extractJsonLd = (): unknown[] => {
  const r: unknown[] = [];
  for (const b of document.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = (b.textContent || '').trim();
    if (!raw) continue;
    try {
      const p: unknown = JSON.parse(raw);
      const items = Array.isArray(p) ? p : [p];
      for (const i of items) {
        const graph = (i as { '@graph'?: unknown } | null)?.['@graph'];
        if (i && Array.isArray(graph)) r.push(...graph);
        else if (i) r.push(i);
      }
    } catch {
      try {
        const rec: unknown = JSON.parse(`[${raw.replace(/}\s*{/g, '},{')}]`);
        if (Array.isArray(rec)) r.push(...rec);
      } catch {
        // unparseable JSON-LD block
      }
    }
  }
  return r;
};

export interface OpenGraphData {
  og: Record<string, string>;
  twitter: Record<string, string>;
  article: Record<string, string>;
}

export const extractOpenGraphAndTwitter = (): OpenGraphData => {
  const og: Record<string, string> = {};
  const tw: Record<string, string> = {};
  const art: Record<string, string> = {};
  document.querySelectorAll('meta[property]').forEach((m) => {
    const p = m.getAttribute('property') || '';
    const c = m.getAttribute('content') || '';
    if (!c) return;
    if (p.startsWith('og:')) og[p] = c;
    else if (p.startsWith('article:')) art[p] = c;
    else if (p.startsWith('product:')) og[p] = c;
  });
  document.querySelectorAll('meta[name]').forEach((m) => {
    const n = m.getAttribute('name') || '';
    const c = m.getAttribute('content') || '';
    if (c && n.startsWith('twitter:')) tw[n] = c;
  });
  return { og, twitter: tw, article: art };
};

type MicrodataItem = Record<string, unknown>;

export const parseItemScope = (root: Element, seen = new Set<Element>()): MicrodataItem | null => {
  if (seen.has(root)) return null;
  seen.add(root);
  const item: MicrodataItem = {};
  const it = root.getAttribute('itemtype');
  const ii = root.getAttribute('itemid');
  if (it) item['@type'] = it;
  if (ii) item['@id'] = ii;
  root.querySelectorAll('[itemprop]').forEach((pe) => {
    let cs = pe.parentElement;
    while (cs && cs !== root && !cs.hasAttribute('itemscope')) cs = cs.parentElement;
    if (cs !== root) return;
    const n = pe.getAttribute('itemprop');
    if (!n) return;
    let v: unknown;
    if (pe.hasAttribute('itemscope')) v = parseItemScope(pe, seen);
    else if (['A', 'AREA', 'LINK'].includes(pe.tagName)) v = pe.getAttribute('href') || '';
    else if (['IMG', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'EMBED', 'IFRAME'].includes(pe.tagName)) {
      v = pe.getAttribute('src') || '';
    } else if (pe.tagName === 'OBJECT') v = pe.getAttribute('data') || '';
    else if (pe.tagName === 'TIME') {
      v = pe.getAttribute('datetime') || cleanInline(pe.textContent || '');
    } else if (pe.tagName === 'METER' || pe.tagName === 'DATA') {
      v = pe.getAttribute('value') || cleanInline(pe.textContent || '');
    } else if (pe.hasAttribute('content')) v = pe.getAttribute('content');
    else v = cleanInline(pe.textContent || '');
    if (v === '' || v == null) return;
    if (Object.prototype.hasOwnProperty.call(item, n)) {
      const existing = item[n];
      if (Array.isArray(existing)) existing.push(v);
      else item[n] = [existing, v];
    } else {
      item[n] = v;
    }
  });
  return item;
};

export const extractMicrodata = (): MicrodataItem[] =>
  [...document.querySelectorAll('[itemscope]')]
    .filter((e) => !e.hasAttribute('itemprop'))
    .map((e) => parseItemScope(e))
    .filter((x): x is MicrodataItem => Boolean(x));

export const buildStructuredDataSection = (
  config: Pick<
    ResolvedConfig,
    'structuredDataPosition' | 'extractJsonLd' | 'extractOpenGraph' | 'extractMicrodata'
  >,
): string[] => {
  if (config.structuredDataPosition === 'never-emit') return [];
  if (!config.extractJsonLd && !config.extractOpenGraph && !config.extractMicrodata) return [];
  const lines: string[] = [];
  let any = false;
  if (config.extractOpenGraph) {
    const { og, twitter, article } = extractOpenGraphAndTwitter();
    if (Object.keys(og).length || Object.keys(twitter).length || Object.keys(article).length) {
      any = true;
      lines.push(
        '<!-- AI: STRUCTURED DATA: OpenGraph + Twitter Cards -->', '',
        '```json', JSON.stringify({ og, twitter, article }, null, 2), '```', '',
      );
    }
  }
  if (config.extractJsonLd) {
    const jl = extractJsonLd();
    if (jl.length) {
      any = true;
      lines.push('<!-- AI: STRUCTURED DATA: JSON-LD / Schema.org -->', '', '```json');
      try {
        lines.push(JSON.stringify(jl, null, 2));
      } catch {
        lines.push(JSON.stringify(jl, (_k, v) => (typeof v === 'function' ? undefined : v), 2));
      }
      lines.push('```', '');
    }
  }
  if (config.extractMicrodata) {
    try {
      const md = extractMicrodata();
      if (md.length) {
        any = true;
        lines.push(
          '<!-- AI: STRUCTURED DATA: Microdata -->', '',
          '```json', JSON.stringify(md, null, 2), '```', '',
        );
      }
    } catch {
      // microdata extraction failed — skip section
    }
  }
  if (!any) return [];
  return ['<!-- AI: STRUCTURED DATA BLOCK START -->', '', ...lines, '<!-- AI: STRUCTURED DATA BLOCK END -->', ''];
};

export const extractInternalStateBlock = (
  config: Pick<ResolvedConfig, 'extractInternalState' | 'internalStateMaskingEnabled'>,
): string[] => {
  if (!config.extractInternalState) return [];
  const collected: Record<string, unknown> = {};
  const w = window as unknown as Record<string, unknown>;
  try {
    const nd = document.getElementById('__NEXT_DATA__');
    if (nd) {
      try {
        collected.__NEXT_DATA__ = JSON.parse(nd.textContent || '');
      } catch {
        // unparseable __NEXT_DATA__
      }
    }
    if (typeof w.__NUXT__ !== 'undefined') {
      try {
        const n = typeof w.__NUXT__ === 'function' ? (w.__NUXT__ as () => unknown)() : w.__NUXT__;
        collected.__NUXT__ = JSON.parse(JSON.stringify(n));
      } catch {
        // non-serializable __NUXT__
      }
    }
    if (typeof w.__INITIAL_STATE__ !== 'undefined') {
      try {
        collected.__INITIAL_STATE__ = JSON.parse(JSON.stringify(w.__INITIAL_STATE__));
      } catch {
        // non-serializable __INITIAL_STATE__
      }
    }
    if (typeof w.__REDUX_STATE__ !== 'undefined') {
      try {
        collected.__REDUX_STATE__ = JSON.parse(JSON.stringify(w.__REDUX_STATE__));
      } catch {
        // non-serializable __REDUX_STATE__
      }
    }
  } catch {
    // internal state collection failed entirely
  }
  if (!Object.keys(collected).length) return [];
  return [
    '<!-- AI: INTERNAL STATE BLOCK START -->',
    `<!-- AI: PII masking: ${config.internalStateMaskingEnabled ? 'YES' : 'NO'} -->`,
    '',
    '```json',
    JSON.stringify(maskPii(collected, config.internalStateMaskingEnabled), null, 2),
    '```',
    '',
    '<!-- AI: INTERNAL STATE BLOCK END -->',
    '',
  ];
};
