// DOM helpers shared by the renderer and the tab/dropdown machinery.
// Ported from Rev-032v2 prototype (Sections 12-13, 15, 20-21, 24 + image/math/pseudo helpers).

import { absUrl, cleanBlock, cleanInline, sleep } from './utils';
import type { ResolvedConfig, SrcResolution } from '../types';

// --- Computed style cache (Section 6) ---

let computedStyleCache = new WeakMap<Element, CSSStyleDeclaration>();

export const getCachedComputedStyle = (el: Element): CSSStyleDeclaration => {
  let c = computedStyleCache.get(el);
  if (!c) {
    c = window.getComputedStyle(el);
    computedStyleCache.set(el, c);
  }
  return c;
};

export const resetComputedStyleCache = (): void => {
  computedStyleCache = new WeakMap<Element, CSSStyleDeclaration>();
};

// --- Visibility (Section 12) ---

export const isVisible = (el: Node | null | undefined): boolean => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  const element = el as HTMLElement;
  const s = getCachedComputedStyle(element);
  if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
  return !element.hidden;
};

// Content visibility — does NOT skip opacity:0 (scroll-triggered animations).
// Elements with opacity:0 often contain critical page sections that animate in
// on scroll (Framer Motion, GSAP, AOS, Intersection Observer).
export const isContentVisible = (el: Node | null | undefined): boolean => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  const element = el as HTMLElement;
  const s = getCachedComputedStyle(element);
  if (s.display === 'none' || s.visibility === 'hidden') return false;
  return !element.hidden;
};

export const isClickablyVisible = (el: Node | null | undefined): boolean => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const element = el as HTMLElement;
  const s = getCachedComputedStyle(element);
  if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
  if (element.hidden) return false;
  const r = element.getBoundingClientRect();
  return (
    r.width > 0 && r.height > 0 &&
    r.right >= 0 && r.left <= window.innerWidth &&
    r.bottom >= 0 && r.top <= window.innerHeight
  );
};

// Page-wide visibility check for tab discovery: unlike isClickablyVisible,
// does NOT require the element to be inside the current viewport.
export const isDiscoverablyVisible = (el: Node | null | undefined): boolean => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const element = el as HTMLElement;
  const s = getCachedComputedStyle(element);
  if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
  if (element.hidden) return false;
  const r = element.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

export const ensureElementInViewport = async (el: Element | null | undefined): Promise<void> => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  } catch {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      // ignore
    }
  }
  await sleep(80);
  resetComputedStyleCache();
};

// Finds the nearest heading above an element (for tab group context).
export const getNearestHeadingText = (el: Element): string => {
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== document.body && depth < 20) {
    let sib: Element | null = node.previousElementSibling;
    let sibDepth = 0;
    while (sib && sibDepth < 5) {
      if (sib.matches && sib.matches('h1,h2,h3,h4,h5,h6')) {
        return (sib.textContent || '').trim().substring(0, 60);
      }
      const innerH = sib.querySelector && sib.querySelector('h1,h2,h3,h4,h5,h6');
      if (innerH) return (innerH.textContent || '').trim().substring(0, 60);
      sib = sib.previousElementSibling;
      sibDepth++;
    }
    node = node.parentElement;
    depth++;
  }
  return '';
};

// --- Image source resolution (Section 13) ---

export const parseSrcset = (s: string | null | undefined): Array<{ url: string; weight: number }> => {
  if (!s || !s.includes(',') || !/\s\d+(\.\d+)?[wx]\b/.test(s)) return [];
  return s
    .split(',')
    .map((p) => p.trim().split(/\s+/))
    .map(([u, d]) => ({ url: u, weight: d ? parseFloat(d) : 0 }))
    .filter((c) => c.url);
};

export const resolveLazyImageSrc = (img: Element | null | undefined): SrcResolution => {
  if (!img || img.nodeType !== Node.ELEMENT_NODE) return { src: '', candidates: [] };
  const image = img as HTMLImageElement;
  const all = [
    image.currentSrc,
    img.getAttribute('src'),
    img.getAttribute('data-src'),
    img.getAttribute('data-original'),
    img.getAttribute('data-lazy-src'),
    img.getAttribute('data-lazy'),
    img.getAttribute('data-defer-src'),
    img.getAttribute('data-srcset'),
    img.getAttribute('srcset'),
  ].filter(Boolean) as string[];
  let candidates: string[] = [];
  for (const c of all) {
    const p = parseSrcset(c);
    if (p.length) {
      candidates = candidates.concat(p.map((x) => absUrl(x.url)));
      const sorted = [...p].sort((a, b) => b.weight - a.weight);
      if (sorted[0]) return { src: absUrl(sorted[0].url), candidates };
      continue;
    }
    if (/^data:image\/[^,]+,[^a-zA-Z0-9]*$/.test(c)) continue;
    if (/^data:image\/svg\+xml/.test(c) && c.length < 200) continue;
    return { src: absUrl(c), candidates };
  }
  return { src: '', candidates };
};

export const resolvePictureSrc = (pic: Element): SrcResolution => {
  let candidates: string[] = [];
  for (const s of pic.querySelectorAll('source')) {
    const ss = s.getAttribute('srcset') || s.getAttribute('data-srcset');
    const p = parseSrcset(ss);
    if (p.length) candidates = candidates.concat(p.map((x) => absUrl(x.url)));
  }
  const fi = pic.querySelector('img');
  if (fi) {
    const f = resolveLazyImageSrc(fi);
    candidates = candidates.concat(f.candidates);
    if (f.src) return { src: f.src, candidates };
  }
  if (candidates.length) return { src: candidates[0], candidates };
  return { src: '', candidates };
};

export const isDecorativeImageSrc = (
  src: string | null | undefined,
  config: Pick<ResolvedConfig, 'filterDecorativeImages' | 'decorativeImageFilenamePatterns'>,
): boolean => {
  if (!config.filterDecorativeImages || !src) return false;
  try {
    const path = new URL(src, location.href).pathname;
    return config.decorativeImageFilenamePatterns.some((p) => p.test(path));
  } catch {
    return false;
  }
};

export const isDecorativeAlt = (
  alt: string | null | undefined,
  config: Pick<ResolvedConfig, 'filterDecorativeAlt' | 'decorativeAltPattern' | 'decorativeAltMaxWords'>,
): boolean => {
  if (!config.filterDecorativeAlt || !alt) return false;
  if (!config.decorativeAltPattern.test(alt)) return false;
  const words = alt.trim().split(/\s+/);
  return words.length <= config.decorativeAltMaxWords;
};

export const shouldSkipImage = (
  src: string,
  alt: string,
  config: Pick<
    ResolvedConfig,
    | 'filterDecorativeImages'
    | 'decorativeImageFilenamePatterns'
    | 'filterDecorativeAlt'
    | 'decorativeAltPattern'
    | 'decorativeAltMaxWords'
  >,
): boolean => {
  if (isDecorativeImageSrc(src, config)) return true;
  if (isDecorativeAlt(alt, config)) return true;
  return false;
};

// --- Shadow DOM walker (Section 15) ---

export const queryAllDeep = (
  root: Node | null | undefined,
  sel: string,
  traverseShadowDom: boolean,
): Element[] => {
  const r: Element[] = [];
  if (!root) return r;
  const v = (n: Node | ShadowRoot | null): void => {
    if (!n) return;
    if (n.nodeType === Node.ELEMENT_NODE && typeof (n as Element).matches === 'function') {
      try {
        if ((n as Element).matches(sel)) r.push(n as Element);
      } catch {
        // ignore invalid selector matches
      }
    }
    const shadow = (n as Element).shadowRoot;
    if (shadow && traverseShadowDom) v(shadow);
    const children = (n as Element).children || n.childNodes || [];
    for (const c of children) {
      if (c.nodeType === Node.ELEMENT_NODE || c.nodeType === Node.DOCUMENT_FRAGMENT_NODE) v(c);
    }
  };
  v(root);
  return r;
};

// --- DOM helpers (Section 20) ---

export const getPrimaryContentRoot = (): Element =>
  document.querySelector('main article') ||
  document.querySelector('article') ||
  document.querySelector('main') ||
  document.querySelector('[role="main"]') ||
  document.body;

export const isInsideDangerousNavigationArea = (el: Node | null | undefined): boolean => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  return Boolean(
    (el as Element).closest(
      'header, nav, aside, summary, #drawer, [id*="drawer" i], [class*="drawer" i], [data-mobile-nav], [data-mobile-nav-tab], [aria-label*="navigation" i], [aria-label*="Primary navigation" i]',
    ),
  );
};

export const isSkippable = (
  el: Node | null | undefined,
  config: Pick<
    ResolvedConfig,
    'skipSelectors' | 'includeVisibleAriaHiddenText' | 'minAriaHiddenTextLength'
  >,
): boolean => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const element = el as Element;
  if (config.skipSelectors.some((s) => element.matches(s))) return true;
  if (element.getAttribute('aria-hidden') === 'true') {
    if (!config.includeVisibleAriaHiddenText) return true;
    const t = cleanInline(element.textContent || '');
    if (!(t.length >= config.minAriaHiddenTextLength && /[\p{L}\p{N}]/u.test(t))) return true;
  }
  return false;
};

export const getVisibleText = (el: Node | null | undefined): string => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE || !isVisible(el)) return '';
  const element = el as HTMLElement;
  return cleanBlock(element.innerText || element.textContent || '');
};

export const getOwnText = (el: Element): string =>
  [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => cleanInline(n.textContent))
    .filter(Boolean)
    .join(' ');

export const getButtonText = (btn: Element): string => {
  const c = btn.cloneNode(true) as HTMLElement;
  c.querySelectorAll('svg, path').forEach((n) => n.remove());
  return cleanInline(
    c.innerText ||
      c.textContent ||
      btn.getAttribute('aria-label') ||
      btn.getAttribute('title') ||
      (btn as HTMLButtonElement).value ||
      '',
  );
};

export const getButtonFallbackLabel = (btn: Element): string => {
  const t = getButtonText(btn);
  if (t) return t;
  const a = cleanInline(btn.getAttribute('aria-label') || '');
  if (a) return a;
  const ti = cleanInline(btn.getAttribute('title') || '');
  if (ti) return ti;
  const id = cleanInline(btn.id || '');
  if (id) return `button#${id}`;
  const hp = btn.getAttribute('aria-haspopup');
  if (hp) return `icon-only ${hp} button`;
  return 'button';
};

export const findEnclosingHref = (el: Element | null | undefined): string => {
  if (!el) return '';
  const a = el.closest('a[href]');
  return a ? absUrl(a.getAttribute('href') || '') : '';
};

export const isDropdownButton = (btn: Node | null | undefined): boolean => {
  if (!btn || btn.nodeType !== Node.ELEMENT_NODE) return false;
  const element = btn as Element;
  const h = element.getAttribute('aria-haspopup');
  const r = element.getAttribute('role') || '';
  return h === 'menu' || h === 'listbox' || h === 'dialog' || r === 'combobox';
};

export const isNavigationLikeButton = (btn: Node | null | undefined): boolean => {
  if (!btn || btn.nodeType !== Node.ELEMENT_NODE) return true;
  const element = btn as Element;
  if (
    element.hasAttribute('data-href') ||
    element.hasAttribute('href') ||
    element.closest('a[href]') ||
    element.getAttribute('aria-haspopup') ||
    isDropdownButton(element) ||
    isInsideDangerousNavigationArea(element)
  ) {
    return true;
  }
  const hl = [
    element.getAttribute('data-url'),
    element.getAttribute('data-to'),
    element.getAttribute('data-path'),
  ]
    .filter(Boolean)
    .join(' ');
  return /^\/|https?:\/\//i.test(hl);
};

// Safety check uses isDiscoverablyVisible (off-viewport tabs are valid).
export const isProbablyUnsafeTabButton = (
  btn: Element,
  config: Pick<ResolvedConfig, 'unsafeTabButtonTextPatterns'>,
): boolean => {
  const t = getButtonText(btn);
  const tp = cleanInline(btn.getAttribute('type') || '').toLowerCase();
  if (tp === 'submit' || tp === 'reset') return true;
  if ((btn as HTMLButtonElement).disabled || btn.getAttribute('aria-disabled') === 'true') {
    return true;
  }
  if (btn.closest('form') || isNavigationLikeButton(btn) || !isDiscoverablyVisible(btn)) {
    return true;
  }
  return config.unsafeTabButtonTextPatterns.some((p) => p.test(t));
};

export const getDirectLabelText = (inp: Element): string => {
  const labels: string[] = [];
  if (inp.id) {
    const eid = window.CSS && CSS.escape ? CSS.escape(inp.id) : inp.id.replace(/"/g, '\\"');
    document.querySelectorAll<HTMLLabelElement>(`label[for="${eid}"]`).forEach((l) =>
      labels.push(cleanInline(l.innerText || l.textContent)),
    );
  }
  const pl = inp.closest('label');
  if (pl) labels.push(cleanInline(pl.innerText || pl.textContent));
  return [...new Set(labels.filter(Boolean))].join(' / ');
};

// --- Anchor helpers (Section 21) ---

export const findFirstImgInAnchor = (a: Element): HTMLImageElement | null => {
  const q: Element[] = [...a.children];
  while (q.length) {
    const n = q.shift();
    if (!n || n.nodeType !== Node.ELEMENT_NODE) continue;
    if (n.tagName === 'IMG') return n as HTMLImageElement;
    if (n.tagName === 'PICTURE') {
      const i = n.querySelector('img');
      if (i) return i;
    }
    if (['NOSCRIPT', 'SCRIPT', 'STYLE', 'A'].includes(n.tagName)) continue;
    if (n.children) q.push(...n.children);
  }
  return null;
};

export const isAnchorContentOnlyImage = (a: Element): boolean => {
  const walk = (n: Node): boolean => {
    if (n.nodeType === Node.TEXT_NODE) return cleanInline(n.textContent).length > 0;
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    if (['IMG', 'PICTURE', 'SOURCE', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'SVG'].includes((n as Element).tagName)) {
      return false;
    }
    for (const c of n.childNodes) if (walk(c)) return true;
    return false;
  };
  for (const c of a.childNodes) if (walk(c)) return false;
  return true;
};

export const collectAnchorText = (el: Element): string => {
  const parts: string[] = [];
  for (const c of el.childNodes) {
    if (c.nodeType === Node.TEXT_NODE) {
      const t = cleanInline(c.textContent);
      if (t) parts.push(t);
    } else if (c.nodeType === Node.ELEMENT_NODE) {
      const child = c as Element;
      const tag = child.tagName;
      if (['NOSCRIPT', 'SCRIPT', 'STYLE'].includes(tag)) continue;
      if (tag === 'IMG') {
        const alt = cleanInline(child.getAttribute('alt') || '');
        if (alt) parts.push(alt);
        continue;
      }
      if (tag === 'PICTURE') {
        const i = child.querySelector('img');
        if (i) {
          const alt = cleanInline(i.getAttribute('alt') || '');
          if (alt) parts.push(alt);
        }
        continue;
      }
      if (tag === 'SVG') {
        const al = cleanInline(child.getAttribute('aria-label') || '');
        if (al) parts.push(al);
        continue;
      }
      const sub = collectAnchorText(child);
      if (sub) parts.push(sub);
    }
  }
  return cleanInline(parts.join(' '));
};

// --- Pseudo-elements / math / meta (Sections 23, 35) ---

export const getPseudoContent = (el: Element, pseudo: '::before' | '::after'): string => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
  try {
    const s = window.getComputedStyle(el, pseudo);
    let c = s.getPropertyValue('content') || '';
    if (!c || c === 'none' || c === 'normal') return '';
    c = c.trim();
    if ((c.startsWith('"') && c.endsWith('"')) || (c.startsWith("'") && c.endsWith("'"))) {
      c = c.slice(1, -1);
    }
    if (/counter\(|counters\(/i.test(c)) return '';
    return cleanInline(c);
  } catch {
    return '';
  }
};

export const isRedundantListPseudoMarker = (
  pt: string | null | undefined,
  lt: 'ul' | 'ol' | null,
): boolean => {
  const t = cleanInline(pt || '');
  if (!t) return true;
  if (lt === 'ul') return /^[•·∙●○◦▪▫■□\-–—*]+$/.test(t);
  if (lt === 'ol') return /^(\d+[\.)]?|[a-zA-Z][\.)]?|[ivxlcdm]+[\.)]?)$/i.test(t);
  return false;
};

export const isMathContainer = (el: Node | null | undefined): boolean => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const element = el as Element;
  if (element.tagName === 'MATH' || element.tagName === 'MJX-CONTAINER') return true;
  const cls = element.className;
  return typeof cls === 'string' && /\b(katex|katex-display|MathJax|mjx-)/.test(cls);
};

export const getMathTex = (el: Element): string | null => {
  const ann = el.querySelector('annotation[encoding*="tex" i], annotation[encoding*="latex" i]');
  if (ann) {
    const t = (ann.textContent || '').trim();
    if (t) return t;
  }
  const al = (el.getAttribute('aria-label') || '').trim();
  if (al) return al;
  const da = (
    el.getAttribute('data-mathml') ||
    el.getAttribute('data-tex') ||
    el.getAttribute('data-original') ||
    ''
  ).trim();
  return da || null;
};

export const getMeta = (sel: string, attr = 'content'): string => {
  const el = document.querySelector(sel);
  return el ? cleanInline(el.getAttribute(attr)) : '';
};

// --- Click / settle (Section 24) ---

export const waitForDomToSettle = (
  root: Element | null,
  tMs: number,
  sMs: number,
): Promise<void> =>
  new Promise((resolve) => {
    let finished = false;
    let st: ReturnType<typeof setTimeout> | null = null;
    const target = root && root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (st) clearTimeout(st);
      clearTimeout(mt);
      ob.disconnect();
      resolve();
    };
    const ob = new MutationObserver(() => {
      if (st) clearTimeout(st);
      st = setTimeout(finish, sMs);
    });
    const mt = setTimeout(finish, tMs);
    ob.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
  });

// Scrolls into viewport before clicking, so off-screen tabs work.
export const clickAndWait = async (
  btn: HTMLElement,
  root: Element | null,
  tMs: number,
  sMs: number,
): Promise<void> => {
  await ensureElementInViewport(btn);
  const w = waitForDomToSettle(root || document.body, tMs, sMs);
  btn.click();
  await w;
  await sleep(80);
};

export const pressEscape = (): void => {
  const o = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent('keydown', o));
  document.dispatchEvent(new KeyboardEvent('keyup', o));
};
