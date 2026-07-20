// DOM → Markdown renderer: inline/block rendering, forms, tables, code blocks,
// buttons and visual markers.
// Ported from Rev-032v2 prototype (Sections 23, 27-32).

import { BLOCK_TAGS, INDENT, INLINE_FORMATTING_TAGS } from '../constants';
import {
  absUrl,
  chooseCodeFence,
  classifyLink,
  cleanBlock,
  cleanInline,
  cleanMailtoTelLabel,
  escapeMd,
  escapeMdTableCell,
  isStepNumberLike,
  isWordPressNoiseLink,
  sanitizeFormFieldValue,
  stripOuterBlankLines,
} from './utils';
import {
  collectAnchorText,
  findEnclosingHref,
  findFirstImgInAnchor,
  getButtonFallbackLabel,
  getCachedComputedStyle,
  getDirectLabelText,
  getMathTex,
  getOwnText,
  getPseudoContent,
  isAnchorContentOnlyImage,
  isContentVisible,
  isDropdownButton,
  isMathContainer,
  isRedundantListPseudoMarker,
  isSkippable,
  resolveLazyImageSrc,
  resolvePictureSrc,
  shouldSkipImage,
} from './dom';
import type { ExtractContext, FormFieldRecord, RenderOptions } from '../types';

type ResolvedRenderOptions = Required<RenderOptions>;

// The prototype's escapeMd read CONFIG.stripNoisyAttributesInLinkText globally;
// every escape in the renderer must keep that behavior.
const esc = (ctx: ExtractContext, t: string | null | undefined): string =>
  escapeMd(t, ctx.config.stripNoisyAttributesInLinkText);

// --- Visual marker helpers (Section 23) ---

export const getElementImportanceNote = (ctx: ExtractContext, el: Element): string => {
  if (!ctx.flags.visualImportanceEnabled || !el || el.nodeType !== Node.ELEMENT_NODE) return '';
  if (/^H[1-6]$/.test(el.tagName)) return '';
  const s = getCachedComputedStyle(el);
  const fs = parseFloat(s.fontSize || '0');
  const fwRaw = s.fontWeight || '400';
  const fw = fwRaw === 'bold' ? 700 : fwRaw === 'normal' ? 400 : parseInt(fwRaw, 10) || 400;
  const n: string[] = [];
  if (fs >= ctx.config.minLargeFontPx) n.push(`large-font:${Math.round(fs)}px`);
  if (fw >= ctx.config.minBoldWeight) n.push(`bold:${fw}`);
  return n.length ? `<!-- AI_STYLE: ${n.join(', ')} -->` : '';
};

// Long aria-hidden text → plain text without marker.
export const getAriaHiddenVisualNote = (ctx: ExtractContext, el: Element): string => {
  if (!ctx.flags.ariaHiddenMarkersEnabled || !el || el.nodeType !== Node.ELEMENT_NODE) return '';
  if (el.getAttribute('aria-hidden') !== 'true') return '';
  const t = cleanInline(el.textContent || '');
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return '';
  // Short markers (step numbers, badges, percentages) keep AI_VISUAL_ONLY.
  if (
    t.length <= ctx.config.longAriaHiddenThreshold &&
    (isStepNumberLike(t) || /^[\d.,]+%?$/.test(t) || /^\$[\d.,]+[KkMm]?$/.test(t))
  ) {
    return '<!-- AI_VISUAL_ONLY: element has aria-hidden="true" but is visually rendered -->';
  }
  return '';
};

export const getStepNumberNote = (ctx: ExtractContext, el: Element): string => {
  if (!ctx.flags.stepMarkersEnabled || !el || el.nodeType !== Node.ELEMENT_NODE) return '';
  const t = cleanInline(el.textContent || '');
  if (!isStepNumberLike(t)) return '';
  return `<!-- AI_STEP_MARKER: ${t} -->`;
};

export const isBadge = (ctx: ExtractContext, el: Element): boolean => {
  if (!ctx.flags.badgesEnabled || !el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (el.tagName !== 'SPAN' && el.tagName !== 'DIV') return false;
  const cls = el.className;
  if (typeof cls !== 'string' || !ctx.config.badgeClassPattern.test(cls)) return false;
  const t = cleanInline((el as HTMLElement).innerText || el.textContent || '');
  return Boolean(t && t.length <= ctx.config.maxBadgeTextLength);
};

// --- Inline rendering (Section 27) ---

export const renderInlineChildren = (ctx: ExtractContext, el: Element): string => {
  const { config } = ctx;
  const parts: string[] = [];
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = cleanInline(child.textContent);
      if (t) parts.push(t.slice(0, config.maxTextNodeLength));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const c = child as HTMLElement;
    if (isSkippable(c, config)) continue;
    if (!config.includeHiddenMeaningfulText && !isContentVisible(c)) continue;
    const tag = c.tagName;
    if (tag === 'BR') {
      parts.push('\n');
      continue;
    }
    if (tag === 'A') {
      const href = absUrl(c.getAttribute('href') || '');
      if (!href || isWordPressNoiseLink(href, config)) continue;
      const realImg = findFirstImgInAnchor(c);
      const onlyImg = realImg && isAnchorContentOnlyImage(c);
      if (realImg && onlyImg) {
        const alt = cleanInline(realImg.getAttribute('alt') || realImg.getAttribute('aria-label') || '');
        const src = resolveLazyImageSrc(realImg).src;
        if (shouldSkipImage(src, alt, config)) continue;
        if (config.typeLinkedImages) {
          const cls = classifyLink(href, alt, true);
          if (cls.type === 'social') {
            parts.push(`[Social: ${esc(ctx, cls.label)}](${href})`);
            continue;
          }
          if (cls.type === 'linked-image') {
            parts.push(`[Linked Image: ${esc(ctx, cls.label)}](${href})`);
            continue;
          }
        }
        if (src) parts.push(`[![${esc(ctx, alt || 'image')}](${src})](${href})`);
        else parts.push(`[image](${href})`);
        continue;
      }
      let text = collectAnchorText(c);
      if (href.startsWith('mailto:') || href.startsWith('tel:')) {
        text = cleanMailtoTelLabel(href, text);
      }
      if (config.typeLinkedImages) {
        const cls = classifyLink(href, text, !!realImg);
        if (cls.type === 'social') {
          parts.push(`[Social: ${esc(ctx, cls.label)}](${href})`);
          continue;
        }
        if (cls.type === 'mailto' || cls.type === 'tel') {
          parts.push(`[${esc(ctx, cls.label)}](${href})`);
          continue;
        }
      }
      if (text && href) parts.push(`[${esc(ctx, text)}](${href})`);
      else if (href) parts.push(`[link](${href})`);
      continue;
    }
    if (tag === 'STRONG' || tag === 'B') {
      const t = renderInlineChildren(ctx, c) || cleanInline(c.textContent);
      if (t) parts.push(`**${t}**`);
      continue;
    }
    if (tag === 'EM' || tag === 'I') {
      const t = renderInlineChildren(ctx, c) || cleanInline(c.textContent);
      if (t) parts.push(`*${t}*`);
      continue;
    }
    if (tag === 'CODE') {
      const t = cleanInline(c.textContent);
      if (t) parts.push(`\`${t}\``);
      continue;
    }
    if (tag === 'IMG') {
      const alt = cleanInline(c.getAttribute('alt') || c.getAttribute('aria-label') || '');
      const { src, candidates } = resolveLazyImageSrc(c);
      if (shouldSkipImage(src, alt, config)) continue;
      if (alt || src) {
        parts.push(`![${esc(ctx, alt || 'image')}](${src})`);
        ctx.appendix.images++;
        if (config.emitImageSrcsetCandidatesComment && candidates.length > 1) {
          parts.push(`<!-- AI_IMAGE_CANDIDATES: ${candidates.join(' | ')} -->`);
        }
      }
      continue;
    }
    if (tag === 'PICTURE') {
      const { src, candidates } = resolvePictureSrc(c);
      const ii = c.querySelector('img');
      const alt = ii ? cleanInline(ii.getAttribute('alt') || '') : '';
      if (shouldSkipImage(src, alt, config)) continue;
      if (src) {
        parts.push(`![${esc(ctx, alt || 'image')}](${src})`);
        ctx.appendix.images++;
        if (config.emitImageSrcsetCandidatesComment && candidates.length > 1) {
          parts.push(`<!-- AI_IMAGE_CANDIDATES: ${candidates.join(' | ')} -->`);
        }
      }
      continue;
    }
    if (isMathContainer(c)) {
      const tex = getMathTex(c);
      if (tex) parts.push(`$${cleanInline(tex)}$`);
      continue;
    }
    if (isBadge(ctx, c)) {
      const t = cleanInline(c.innerText || c.textContent || '');
      if (t) parts.push(`[Badge: ${esc(ctx, t)}]`);
      continue;
    }
    if (
      tag === 'BUTTON' ||
      c.getAttribute('role') === 'button' ||
      c.getAttribute('role') === 'tab' ||
      c.getAttribute('role') === 'combobox'
    ) {
      const t = getButtonFallbackLabel(c);
      const eh = findEnclosingHref(c);
      if (eh && t) parts.push(`[CTA Button: ${esc(ctx, t)}](${eh})`);
      else if (isDropdownButton(c)) parts.push(`[Dropdown Button: ${t}]`);
      else parts.push(`[Button: ${t}]`);
      continue;
    }
    if (INLINE_FORMATTING_TAGS.has(tag)) {
      const t = renderInlineChildren(ctx, c) || cleanInline(c.textContent);
      if (t) parts.push(t);
      continue;
    }
    const t = cleanInline(c.innerText || c.textContent);
    if (t) parts.push(t);
  }
  return cleanInline(parts.join(' ')).replace(/\s+\n\s+/g, '\n');
};

export const renderLiInlineText = (ctx: ExtractContext, li: Element): string => {
  const cl = li.cloneNode(true) as Element;
  cl.querySelectorAll('ul, ol, dl, table, blockquote, details, figure, pre').forEach((n) => n.remove());
  return renderInlineChildren(ctx, cl);
};

// --- Form rendering (Section 28) ---

export const renderForm = (ctx: ExtractContext, form: HTMLFormElement, depth: number): string[] => {
  const { config } = ctx;
  const indent = INDENT.repeat(depth);
  const action = absUrl(form.getAttribute('action') || location.href);
  const method = (form.getAttribute('method') || 'GET').toUpperCase();
  const formName = form.getAttribute('name') || form.getAttribute('id') || '';
  const allControls = [...form.querySelectorAll<HTMLElement>('input, textarea, select, button')];
  const visibleFields: FormFieldRecord[] = [];
  const hiddenFields: FormFieldRecord[] = [];
  allControls.forEach((c) => {
    const tag = c.tagName.toLowerCase();
    const type = (c.getAttribute('type') || tag).toLowerCase();
    const ch = c.style && (c.style.display === 'none' || c.style.visibility === 'hidden');
    const isH = type === 'hidden' || ch;
    const fd: FormFieldRecord = {
      tag,
      type,
      label: getDirectLabelText(c),
      name: c.getAttribute('name') || '',
      placeholder: c.getAttribute('placeholder') || '',
      rawValue: c.getAttribute('value') || '',
      aria: c.getAttribute('aria-label') || '',
      text: cleanInline(c.innerText || c.textContent || ''),
      required: c.hasAttribute('required'),
      autocomplete: c.getAttribute('autocomplete') || '',
      sanitizedValue: '',
    };
    fd.sanitizedValue = sanitizeFormFieldValue(fd.name, fd.rawValue, type, config);
    if (isH) hiddenFields.push(fd);
    else visibleFields.push(fd);
  });
  const lines = [
    '',
    `${indent}<!-- AI: FORM START${formName ? ` — ${formName}` : ''} -->`,
    `${indent}**Form** — \`${method}\` → ${action}`,
  ];
  if (!visibleFields.length) lines.push(`${indent}- (no visible fields)`);
  else {
    visibleFields.forEach((f) => {
      const ll = f.label || f.placeholder || f.aria || f.text || f.name || '(unnamed)';
      const fl: string[] = [];
      if (f.required) fl.push('required');
      if (f.type && f.type !== f.tag) fl.push(f.type);
      else fl.push(f.tag);
      lines.push(`${indent}- **${esc(ctx, ll)}** (${fl.join(', ')})`);
    });
  }
  lines.push(`${indent}<!-- AI: FORM END -->`, '');
  ctx.appendix.forms.push({ action, method, formName, visibleFields, hiddenFields });
  return lines;
};

// --- Table rendering (Section 29) ---

export const renderTable = (table: HTMLTableElement, depth: number): string[] => {
  const lines: string[] = [];
  const pfx = INDENT.repeat(depth);
  const cap = table.querySelector(':scope > caption');
  if (cap) {
    const ct = cleanInline(cap.textContent || '');
    if (ct) lines.push('', `${pfx}**${escapeMd(ct)}**`);
  }
  const hs = table.querySelector(':scope > thead');
  const bss = [...table.querySelectorAll(':scope > tbody')];
  const fs = table.querySelector(':scope > tfoot');
  const hr = hs ? [...hs.querySelectorAll(':scope > tr')] : [];
  const br: Element[] = [];
  bss.forEach((tb) => br.push(...tb.querySelectorAll(':scope > tr')));
  const fr = fs ? [...fs.querySelectorAll(':scope > tr')] : [];
  let ar: Element[];
  if (hr.length || br.length || fr.length) ar = [...hr, ...br, ...fr];
  else {
    ar = [...table.querySelectorAll(':scope > tr')];
    if (!ar.length) ar = [...table.querySelectorAll('tr')];
  }
  const rd = ar
    .map((tr) =>
      [...tr.querySelectorAll<HTMLElement>(':scope > th, :scope > td')].map((c) =>
        escapeMdTableCell(c.innerText || c.textContent || ''),
      ),
    )
    .filter((r) => r.length);
  if (!rd.length) return lines;
  const mc = Math.max(...rd.map((r) => r.length));
  const nr = rd.map((r) => {
    const cp = [...r];
    while (cp.length < mc) cp.push('');
    return cp;
  });
  lines.push('');
  const h = nr[0];
  lines.push(`${pfx}| ${h.join(' | ')} |`);
  lines.push(`${pfx}| ${h.map(() => '---').join(' | ')} |`);
  nr.slice(1).forEach((r) => lines.push(`${pfx}| ${r.join(' | ')} |`));
  lines.push('');
  return lines;
};

// --- Code block rendering (Section 30) ---

export const renderCodeBlock = (ctx: ExtractContext, el: Element): string[] => {
  const codeEl = el.querySelector('code') || el;
  const extractShiki = (): string => {
    const ls = [...codeEl.querySelectorAll(':scope > .line, .line')];
    if (!ls.length) return '';
    return ls
      .map((l) => String(l.textContent || '').replace(/\u00a0/g, ' ').replace(/\r/g, ''))
      .join('\n');
  };
  const extractFallback = (): string => {
    const cs = [
      extractShiki(),
      codeEl.textContent,
      el.textContent,
      (codeEl as HTMLElement).innerText,
      (el as HTMLElement).innerText,
    ]
      .map((v) => stripOuterBlankLines(v || ''))
      .filter((v) => v && v.trim());
    if (!cs.length) return '';
    const si = (t: string): number =>
      t.split('\n').reduce((s, l) => {
        const m = l.match(/^[ \t]+/);
        return s + (m ? m[0].length : 0);
      }, 0);
    return cs.sort((a, b) => si(b) - si(a))[0];
  };
  const normCode = (t: string): string => {
    const ls = String(t || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').split('\n');
    while (ls.length && ls[0].trim() === '') ls.shift();
    while (ls.length && ls[ls.length - 1].trim() === '') ls.pop();
    return ls.join('\n');
  };
  const text = normCode(extractFallback());
  if (!text.trim()) return [];
  const lang =
    codeEl.getAttribute('data-language') ||
    el.getAttribute('data-language') ||
    (codeEl.className.match(/language-([a-z0-9_-]+)/i) || [])[1] ||
    (el.className.match(/language-([a-z0-9_-]+)/i) || [])[1] ||
    '';
  const fence = chooseCodeFence(text);
  const lines = ['', `${fence}${cleanInline(lang)}`];
  text.split('\n').forEach((l) => lines.push(l));
  lines.push(fence, '');
  ctx.appendix.codeBlocks++;
  return lines;
};

// --- Button rendering (Section 31) ---

export const renderButton = (
  ctx: ExtractContext,
  btn: HTMLElement,
  depth: number,
  opts: ResolvedRenderOptions,
): string[] => {
  const lines: string[] = [];
  const pfx = INDENT.repeat(depth);
  const text = getButtonFallbackLabel(btn);
  const bid = btn.dataset.aiExporterButtonId || '';
  const did = btn.dataset.aiExporterDropdownId || '';
  const tp = ctx.state.tabPanelsByButtonId.get(bid);
  const dp = ctx.state.dropdownPanelsByButtonId.get(did);
  // Tab with captured panel content.
  if (tp && opts.expandTabs) {
    lines.push(`${pfx}[Tab Button: ${text}]`, '', `${pfx}<!-- AI: TAB PANEL START: ${text} -->`, '');
    if (tp.lines && tp.lines.length) lines.push(...tp.lines);
    else if (tp.text) lines.push(tp.text);
    lines.push('', `${pfx}<!-- AI: TAB PANEL END: ${text} -->`, '');
    return lines;
  }
  // Dropdown button.
  if (isDropdownButton(btn)) {
    const exp = btn.getAttribute('aria-expanded');
    const pop = btn.getAttribute('aria-haspopup') || 'menu';
    lines.push(
      `${pfx}[Dropdown Button: ${text} | popup:${pop}${exp !== null ? ` | expanded:${exp}` : ''}]`,
    );
    if (dp && opts.expandDropdowns) {
      lines.push('', `${pfx}<!-- AI: DROPDOWN PANEL START: ${text} -->`, '');
      if (dp.lines && dp.lines.length) lines.push(...dp.lines);
      lines.push('', `${pfx}<!-- AI: DROPDOWN PANEL END: ${text} -->`, '');
    }
    return lines;
  }
  // CTA button inside <a href>.
  const eh = findEnclosingHref(btn);
  if (eh && text) {
    lines.push(`${pfx}[CTA Button: ${esc(ctx, text)}](${eh})`);
    return lines;
  }
  // Known tab button without captured panel — still label as Tab Button.
  if (bid && ctx.state.knownTabButtonIds.has(bid)) {
    lines.push(`${pfx}[Tab Button: ${text}]`);
    return lines;
  }
  lines.push(`${pfx}[Button: ${text}]`);
  return lines;
};

// --- Main render (Section 32) ---

export const renderNode = (
  ctx: ExtractContext,
  node: Node,
  depth = 0,
  options: RenderOptions = {},
): string[] => {
  const { config } = ctx;
  const opts: ResolvedRenderOptions = {
    expandTabs: true,
    expandDropdowns: true,
    includeRegionMarkers: true,
    skipCapturedTabPanels: config.skipCapturedTabPanelsInMainRender,
    skipCapturedDropdownPanels: config.skipCapturedDropdownPanelsInMainRender,
    listType: null,
    listIndex: null,
    ...options,
  };
  const lines: string[] = [];
  if (node.nodeType === Node.TEXT_NODE) {
    const t = cleanInline(node.textContent);
    if (t) lines.push(t.slice(0, config.maxTextNodeLength));
    return lines;
  }
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    for (const c of node.childNodes) lines.push(...renderNode(ctx, c, depth, opts));
    return lines;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return lines;
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (isSkippable(el, config)) return lines;
  if (!config.includeHiddenMeaningfulText && !isContentVisible(el)) return lines;
  if (opts.skipCapturedTabPanels && ctx.state.capturedTabPanelElements.has(el)) {
    lines.push('', '<!-- AI: TAB PANEL ORIGINAL LOCATION SKIPPED -->', '');
    return lines;
  }
  if (opts.skipCapturedDropdownPanels && ctx.state.capturedDropdownPanelElements.has(el)) {
    lines.push('', '<!-- AI: DROPDOWN PANEL ORIGINAL LOCATION SKIPPED -->', '');
    return lines;
  }
  const pfx = INDENT.repeat(depth);
  const importanceNote = getElementImportanceNote(ctx, el);
  const ariaHiddenNote = getAriaHiddenVisualNote(ctx, el);
  const stepNote = getStepNumberNote(ctx, el);

  if (el.getAttribute('aria-hidden') === 'true') {
    const vt = cleanInline(el.textContent || '');
    if (vt && /[\p{L}\p{N}]/u.test(vt)) {
      lines.push('');
      if (ariaHiddenNote) lines.push(ariaHiddenNote);
      if (stepNote) lines.push(stepNote);
      if (importanceNote) lines.push(importanceNote);
      lines.push(vt);
      lines.push('');
      return lines;
    }
  }

  if (opts.includeRegionMarkers) {
    if (tag === 'HEADER') lines.push('', '<!-- AI: HEADER START -->', '');
    if (tag === 'FOOTER') lines.push('', '<!-- AI: FOOTER START -->', '');
    if (tag === 'MAIN') lines.push('', '<!-- AI: MAIN CONTENT START -->', '');
    if (tag === 'NAV') {
      const nl = el.getAttribute('aria-label') || getOwnText(el) || 'Navigation';
      lines.push('', `<!-- AI: NAVIGATION START: ${cleanInline(nl)} -->`, '');
    }
  }

  if (tag === 'FOOTER') {
    el.querySelectorAll('a[href]').forEach((a) => {
      const href = absUrl(a.getAttribute('href') || '');
      if (!href || isWordPressNoiseLink(href, config)) return;
      const ri = findFirstImgInAnchor(a);
      let text: string;
      if (ri && isAnchorContentOnlyImage(a)) {
        text = cleanInline(ri.getAttribute('alt') || ri.getAttribute('aria-label') || '');
      } else {
        text = collectAnchorText(a);
      }
      if (href.startsWith('mailto:') || href.startsWith('tel:')) {
        text = cleanMailtoTelLabel(href, text);
      }
      if (text || href) ctx.appendix.footerLinks.push({ text: text || '(image link)', href });
    });
  }

  if (isMathContainer(el)) {
    const tex = getMathTex(el);
    if (tex) {
      const isD =
        el.classList &&
        (el.classList.contains('katex-display') || el.getAttribute('display') === 'block');
      lines.push('');
      if (isD) lines.push('$$', cleanInline(tex), '$$');
      else lines.push(`$${cleanInline(tex)}$`);
      lines.push('');
      if (config.traverseShadowDom && el.shadowRoot) {
        for (const c of el.shadowRoot.childNodes) lines.push(...renderNode(ctx, c, depth, opts));
      }
      return lines;
    }
  }
  if (tag === 'IFRAME') {
    if (config.extractIframeSources) {
      const src = absUrl(el.getAttribute('src') || el.getAttribute('data-src') || '');
      const title = cleanInline(el.getAttribute('title') || '');
      if (src) {
        lines.push(
          '',
          `${pfx}<!-- AI: IFRAME EMBED -->`,
          `${pfx}[Embedded iframe${title ? `: ${esc(ctx, title)}` : ''}](${src})`,
          '',
        );
        ctx.appendix.iframes.push({ src, title });
      }
    }
    return lines;
  }
  if (tag === 'PICTURE') {
    const { src, candidates } = resolvePictureSrc(el);
    const ii = el.querySelector('img');
    const alt = ii ? cleanInline(ii.getAttribute('alt') || '') : '';
    if (shouldSkipImage(src, alt, config)) return lines;
    if (src) {
      lines.push(`${pfx}![${esc(ctx, alt || 'image')}](${src})`);
      ctx.appendix.images++;
      if (config.emitImageSrcsetCandidatesComment && candidates.length > 1) {
        lines.push(`${pfx}<!-- AI_IMAGE_CANDIDATES: ${candidates.join(' | ')} -->`);
      }
    }
    return lines;
  }
  if (tag === 'DL') {
    lines.push('');
    for (const c of el.children) {
      if (c.tagName === 'DT') {
        const t = renderInlineChildren(ctx, c);
        if (t) lines.push(`${pfx}**${t}**`);
      } else if (c.tagName === 'DD') {
        const t = renderInlineChildren(ctx, c);
        if (t) t.split('\n').forEach((l, i) => lines.push(`${pfx}${i === 0 ? ': ' : '  '}${l}`));
      }
    }
    lines.push('');
    return lines;
  }
  if (tag === 'FIGURE') {
    lines.push('');
    for (const c of el.childNodes) {
      if (c.nodeType === Node.ELEMENT_NODE && (c as Element).tagName === 'FIGCAPTION') {
        const ct = renderInlineChildren(ctx, c as Element);
        if (ct) lines.push(`${pfx}> *${ct}*`);
      } else {
        lines.push(...renderNode(ctx, c, depth, opts));
      }
    }
    lines.push('');
    if (config.traverseShadowDom && el.shadowRoot) {
      for (const c of el.shadowRoot.childNodes) lines.push(...renderNode(ctx, c, depth, opts));
    }
    return lines;
  }
  if (isBadge(ctx, el)) {
    const t = cleanInline(el.innerText || el.textContent || '');
    if (t) lines.push(`${pfx}[Badge: ${esc(ctx, t)}]`);
    return lines;
  }

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const t = renderInlineChildren(ctx, el) || cleanInline(el.innerText || el.textContent);
    if (t) {
      lines.push('', `${'#'.repeat(level)} ${t}`, '');
      ctx.appendix.headings++;
    }
  } else if (tag === 'PRE') {
    lines.push(...renderCodeBlock(ctx, el));
  } else if (tag === 'CODE') {
    if (!el.closest('pre')) {
      const t = config.preserveCodeWhitespace
        ? stripOuterBlankLines(el.textContent || '')
        : cleanInline(el.textContent || '');
      if (t) {
        if (t.includes('\n')) {
          const f = chooseCodeFence(t);
          lines.push('', f);
          t.split('\n').forEach((l) => lines.push(l));
          lines.push(f, '');
        } else {
          lines.push(`${pfx}\`${t}\``);
        }
      }
    }
  } else if (tag === 'P') {
    const t = renderInlineChildren(ctx, el);
    if (t) {
      lines.push('');
      if (ariaHiddenNote) lines.push(ariaHiddenNote);
      if (stepNote) lines.push(stepNote);
      if (importanceNote) lines.push(importanceNote);
      lines.push(t);
      lines.push('');
    }
  } else if (tag === 'A') {
    const href = absUrl(el.getAttribute('href') || '');
    if (!href || isWordPressNoiseLink(href, config)) return lines;
    const ri = findFirstImgInAnchor(el);
    const oi = ri && isAnchorContentOnlyImage(el);
    if (ri && oi) {
      const alt = cleanInline(ri.getAttribute('alt') || ri.getAttribute('aria-label') || '');
      const src = resolveLazyImageSrc(ri).src;
      if (shouldSkipImage(src, alt, config)) return lines;
      let rendered = false;
      if (config.typeLinkedImages) {
        const cls = classifyLink(href, alt, true);
        if (cls.type === 'social') {
          lines.push(`${pfx}- [Social: ${esc(ctx, cls.label)}](${href})`);
          ctx.appendix.links++;
          rendered = true;
        } else if (cls.type === 'linked-image') {
          lines.push(`${pfx}- [Linked Image: ${esc(ctx, cls.label)}](${href})`);
          ctx.appendix.links++;
          ctx.appendix.images++;
          rendered = true;
        }
      }
      if (!rendered) {
        if (src) {
          lines.push(`${pfx}- [![${esc(ctx, alt || 'image')}](${src})](${href})`);
          ctx.appendix.images++;
        } else {
          lines.push(`${pfx}- [${esc(ctx, alt || 'image')}](${href})`);
        }
        ctx.appendix.links++;
      }
    } else {
      let text = collectAnchorText(el);
      if (href.startsWith('mailto:') || href.startsWith('tel:')) {
        text = cleanMailtoTelLabel(href, text);
      }
      // Skip generic empty links.
      if ((!text || text === 'link') && (href === '#' || href.endsWith('/#'))) return lines;
      if (config.typeLinkedImages) {
        const cls = classifyLink(href, text, !!ri);
        if (cls.type === 'social') {
          lines.push(`${pfx}- [Social: ${esc(ctx, cls.label)}](${href})`);
          ctx.appendix.links++;
          return lines;
        }
      }
      if (text && href) {
        lines.push(`${pfx}- [${esc(ctx, text)}](${href})`);
        ctx.appendix.links++;
      } else if (href) {
        lines.push(`${pfx}- [link](${href})`);
        ctx.appendix.links++;
      }
    }
  } else if (
    tag === 'BUTTON' ||
    el.getAttribute('role') === 'button' ||
    el.getAttribute('role') === 'tab' ||
    el.getAttribute('role') === 'combobox'
  ) {
    lines.push(...renderButton(ctx, el, depth, opts));
  } else if (tag === 'IMG') {
    const alt = cleanInline(el.getAttribute('alt') || el.getAttribute('aria-label') || '');
    const { src, candidates } = resolveLazyImageSrc(el);
    if (shouldSkipImage(src, alt, config)) return lines;
    if (alt || src) {
      lines.push(`${pfx}![${esc(ctx, alt || 'image')}](${src})`);
      ctx.appendix.images++;
      if (config.emitImageSrcsetCandidatesComment && candidates.length > 1) {
        lines.push(`${pfx}<!-- AI_IMAGE_CANDIDATES: ${candidates.join(' | ')} -->`);
      }
    }
  } else if (tag === 'FORM') {
    return renderForm(ctx, el as HTMLFormElement, depth);
  } else if (tag === 'TABLE') {
    return renderTable(el as HTMLTableElement, depth);
  } else if (tag === 'LI') {
    const text = renderLiInlineText(ctx, el);
    const parentTag = el.parentElement ? el.parentElement.tagName : '';
    const listType = opts.listType || (parentTag === 'OL' ? 'ol' : 'ul');
    const pseudoB = config.includePseudoBeforeText ? getPseudoContent(el, '::before') : '';
    const pseudoA = config.includePseudoAfterText ? getPseudoContent(el, '::after') : '';
    const marker = listType === 'ol' ? `${opts.listIndex || 1}.` : '-';
    const incPB = pseudoB && !isRedundantListPseudoMarker(pseudoB, listType);
    const rt = cleanInline([incPB ? pseudoB : '', text, pseudoA].filter(Boolean).join(' '));
    if (rt) {
      if (ariaHiddenNote) lines.push(`${pfx}${ariaHiddenNote}`);
      if (stepNote) lines.push(`${pfx}${stepNote}`);
      if (importanceNote) lines.push(`${pfx}${importanceNote}`);
      lines.push(`${pfx}${marker} ${rt}`);
    }
    for (const c of el.children) {
      if (c.tagName === 'UL' || c.tagName === 'OL') {
        lines.push(...renderNode(ctx, c, depth + 1, opts));
      }
    }
  } else if (tag === 'UL' || tag === 'OL') {
    const lis = [...el.children].filter((c) => c.tagName === 'LI');
    for (let i = 0; i < lis.length; i++) {
      lines.push(
        ...renderNode(ctx, lis[i], depth, {
          ...opts,
          listType: tag === 'OL' ? 'ol' : 'ul',
          listIndex: i + 1,
        }),
      );
    }
  } else if (tag === 'BLOCKQUOTE') {
    const t = cleanBlock(el.innerText || el.textContent);
    if (t) {
      lines.push('');
      t.split('\n').forEach((l) => lines.push(`> ${cleanInline(l)}`));
      lines.push('');
    }
  } else if (tag === 'DETAILS') {
    const se = el.querySelector(':scope > summary') || el.querySelector('summary');
    const st = se
      ? renderInlineChildren(ctx, se) ||
        cleanInline((se as HTMLElement).innerText || se.textContent || 'Expandable details')
      : 'Expandable details';
    lines.push('', `<!-- AI: DETAILS START: ${st} -->`, `**Details:** ${st}`, '');
    for (const c of el.childNodes) {
      if (c.nodeType === Node.ELEMENT_NODE && (c as Element).tagName === 'SUMMARY') continue;
      lines.push(...renderNode(ctx, c, depth, opts));
    }
    lines.push('', `<!-- AI: DETAILS END: ${st} -->`, '');
  } else {
    const ownBlock =
      BLOCK_TAGS.has(tag) &&
      !['DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'NAV'].includes(tag);
    if (ownBlock) {
      const t = renderInlineChildren(ctx, el);
      if (t) {
        lines.push('');
        if (ariaHiddenNote) lines.push(ariaHiddenNote);
        if (stepNote) lines.push(stepNote);
        if (importanceNote) lines.push(importanceNote);
        lines.push(t);
        lines.push('');
      }
    } else {
      let renderedAtomic = false;
      if (importanceNote || ariaHiddenNote || stepNote) {
        const ot = getOwnText(el);
        if (ot && ot.length >= config.minAriaHiddenTextLength) {
          lines.push('');
          if (ariaHiddenNote) lines.push(ariaHiddenNote);
          if (stepNote) lines.push(stepNote);
          if (importanceNote) lines.push(importanceNote);
          lines.push(ot);
          lines.push('');
          if (el.getAttribute('aria-hidden') === 'true' || isStepNumberLike(ot)) {
            renderedAtomic = true;
          }
        }
      }
      if (!renderedAtomic) {
        for (const c of el.childNodes) lines.push(...renderNode(ctx, c, depth, opts));
      }
    }
  }

  if (config.traverseShadowDom && el.shadowRoot) {
    for (const c of el.shadowRoot.childNodes) lines.push(...renderNode(ctx, c, depth, opts));
  }
  if (opts.includeRegionMarkers) {
    if (tag === 'NAV') lines.push('', '<!-- AI: NAVIGATION END -->', '');
    if (tag === 'MAIN') lines.push('', '<!-- AI: MAIN CONTENT END -->', '');
    if (tag === 'HEADER') lines.push('', '<!-- AI: HEADER END -->', '');
    if (tag === 'FOOTER') lines.push('', '<!-- AI: FOOTER END -->', '');
  }
  return lines;
};
