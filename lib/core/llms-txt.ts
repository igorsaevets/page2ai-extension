// Official Markdown discovery: <link rel="alternate">, /page.md patterns and
// llms.txt site indexes (Mintlify/Docusaurus/GitBook docs).
// Ported from Rev-032v2 prototype (Section 36, discovery + policy).

import type { OfficialMarkdownResult, ProgressCallback, ResolvedConfig } from '../types';

export const isTrustedHost = (
  config: Pick<ResolvedConfig, 'trustedOfficialMarkdownHosts'>,
  hostname: string = location.hostname,
): boolean => config.trustedOfficialMarkdownHosts.includes(hostname);

export const isLlmsFile = (u: string): boolean => {
  try {
    return /\/llms(?:\.full)?\.txt$/i.test(new URL(u, location.href).pathname);
  } catch {
    return false;
  }
};

export const isPageSpecificMd = (u: string): boolean => {
  try {
    const p = new URL(u, location.href);
    const cp = p.pathname.replace(/\/+$/, '');
    const cur = location.pathname.replace(/\/+$/, '') || '/';
    if (isLlmsFile(p.href)) return false;
    if (cp.endsWith('/index.md')) return (cp.replace(/\/index\.md$/i, '') || '/') === cur;
    if (cp.endsWith('.md')) return (cp.replace(/\.md$/i, '') || '/') === cur;
    return false;
  } catch {
    return false;
  }
};

// If a .md URL was discovered via llms.txt, trust same-origin even without whitelist.
export const shouldUseOfficialMd = (
  u: string,
  config: Pick<ResolvedConfig, 'officialMarkdownMode' | 'trustedOfficialMarkdownHosts'>,
): boolean => {
  const m = config.officialMarkdownMode;
  if (m === 'never') return false;
  if (m === 'always') return !isLlmsFile(u);
  if (!isPageSpecificMd(u)) return false;
  if (m === 'page-specific') return true;
  if (m === 'trusted-docs-only') {
    if (isTrustedHost(config)) return true;
    try {
      const urlHost = new URL(u, location.href).hostname;
      if (urlHost === location.hostname) return true;
    } catch {
      // ignore
    }
    return false;
  }
  return false;
};

export const fetchOfficialMd = async (
  config: Pick<ResolvedConfig, 'officialMarkdownMode' | 'trustedOfficialMarkdownHosts'>,
  progress?: ProgressCallback,
): Promise<OfficialMarkdownResult | null> => {
  const cands: string[] = [];

  // 1) Explicit alternate links in <head>
  document
    .querySelectorAll('link[rel="alternate"][type="text/markdown"], link[rel="alternate"][type="text/plain"]')
    .forEach((l) => {
      const h = l.getAttribute('href');
      if (h) cands.push(new URL(h, location.href).href);
    });

  // 2) Common page-specific .md URL patterns
  const np = location.pathname.replace(/\/$/, '');
  cands.push(new URL(`${np}.md`, location.origin).href); // /page.md (Mintlify)
  cands.push(new URL(`${np}/index.md`, location.origin).href); // /page/index.md

  // 3) llms.txt discovery — find page-specific .md from site index
  const llmsPaths = ['/docs/llms.txt', '/llms.txt', '/llms-full.txt'];
  const currentPath = np || '/';
  for (const lp of llmsPaths) {
    try {
      const llmsUrl = new URL(lp, location.origin).href;
      const r = await fetch(llmsUrl, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) continue;
      const txt = await r.text();
      if (txt.length > 500000) continue;
      const linkRegex = /\((https?:\/\/[^)]+?\.md)\)/g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(txt)) !== null) {
        try {
          const u = new URL(match[1]);
          const p = u.pathname.replace(/\.md$/i, '').replace(/\/$/, '') || '/';
          if (p === currentPath) cands.push(u.href);
        } catch {
          // ignore malformed URL
        }
      }
      const plainRegex = /(?:^|\s)(https?:\/\/\S+?\.md)(?:\s|$)/gm;
      while ((match = plainRegex.exec(txt)) !== null) {
        try {
          const u = new URL(match[1]);
          const p = u.pathname.replace(/\.md$/i, '').replace(/\/$/, '') || '/';
          if (p === currentPath) cands.push(u.href);
        } catch {
          // ignore malformed URL
        }
      }
    } catch {
      // llms.txt not reachable — keep going
    }
  }

  // Dedupe and filter by officialMarkdownMode policy
  const unique = [...new Set(cands)].filter((u) => shouldUseOfficialMd(u, config));
  for (const u of unique) {
    try {
      const r = await fetch(u, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      const t = await r.text();
      const tr = t.trim();
      const isH = /^<!doctype html/i.test(tr) || /^<html[\s>]/i.test(tr) || ct.includes('text/html');
      const isM =
        !isH &&
        (ct.includes('text/markdown') || ct.includes('text/plain') ||
          /^#\s+/m.test(t) || /```/.test(t) || /\n-\s+/.test(t));
      if (!isM) continue;
      if (tr.length < 200) continue;
      progress?.('official-md', `found official markdown at ${u}`);
      return { url: u, markdown: t };
    } catch {
      // fetch failed — try next candidate
    }
  }
  return null;
};
