// Tab & dropdown machinery: discovery, safe clicking, panel capture with
// content-delta fallbacks, URL drift protection.
// Ported from Rev-032v2 prototype (Sections 26, 33-34 + URL drift from 24).

import { cleanBlock, cleanInline, sleep } from './utils';
import {
  clickAndWait,
  getButtonFallbackLabel,
  getButtonText,
  getNearestHeadingText,
  getPrimaryContentRoot,
  getVisibleText,
  isClickablyVisible,
  isDiscoverablyVisible,
  isDropdownButton,
  isInsideDangerousNavigationArea,
  isProbablyUnsafeTabButton,
  isSkippable,
  isVisible,
  pressEscape,
  queryAllDeep,
  resetComputedStyleCache,
} from './dom';
import { renderNode } from './html-to-md';
import { normalizeMarkdownPreserveCode } from './md-postprocess';
import type {
  ExtractContext,
  ExtractorState,
  ResolvedConfig,
  TabGroup,
  TabPanelCapture,
} from '../types';

// --- URL drift (Section 24) ---

export const isUrlDrifted = (state: ExtractorState): boolean => location.href !== state.initialUrl;

export const tryRestoreUrl = async (state: ExtractorState): Promise<boolean> => {
  if (!isUrlDrifted(state)) return true;
  try {
    history.back();
    await sleep(300);
  } catch {
    // history.back can throw in sandboxed frames
  }
  return !isUrlDrifted(state);
};

// --- Tab & dropdown discovery (Section 26) ---

export const getAllPotentialButtons = (
  root: Element,
  config: Pick<ResolvedConfig, 'traverseShadowDom'>,
): HTMLElement[] => {
  if (!config.traverseShadowDom) {
    return [...root.querySelectorAll<HTMLElement>('button, [role="tab"]')];
  }
  const seen = new Set<Element>();
  return [
    ...queryAllDeep(root, 'button', config.traverseShadowDom),
    ...queryAllDeep(root, '[role="tab"]', config.traverseShadowDom),
  ].filter((e) => {
    if (seen.has(e)) return false;
    seen.add(e);
    return true;
  }) as HTMLElement[];
};

export const getTabGroupButtons = (c: Element, config: ResolvedConfig): HTMLElement[] =>
  [...c.querySelectorAll<HTMLElement>('button, [role="tab"]')].filter((b) => {
    const t = getButtonText(b);
    return (
      Boolean(t) &&
      t.length >= config.minTabButtonTextLength &&
      t.length <= config.maxTabButtonTextLength &&
      isDiscoverablyVisible(b) &&
      !isProbablyUnsafeTabButton(b, config)
    );
  });

export const hasTabLikeAttributes = (bs: HTMLElement[]): boolean =>
  bs.some(
    (b) =>
      b.getAttribute('role') === 'tab' ||
      b.hasAttribute('aria-selected') ||
      b.hasAttribute('aria-controls') ||
      b.hasAttribute('data-state') ||
      b.hasAttribute('data-tab') ||
      /active|selected|current|primary|bg-primary/i.test(b.className || ''),
  );

// Discovers every real tab/code group, even when labels repeat. Mintlify reuses
// Python|TypeScript across many code groups: dedup by labels alone kept only the
// first group, so the signature is labels + heading context + DOM position.
export const discoverTabGroups = (ctx: ExtractContext): TabGroup[] => {
  const { config } = ctx;
  const groups: TabGroup[] = [];
  const used = new Set<Element>();
  const root = getPrimaryContentRoot();
  const push = (c: Element, bs: HTMLElement[], reason: string): void => {
    const safe = bs.filter((b) => !isProbablyUnsafeTabButton(b, config));
    const ut = [...new Set(safe.map(getButtonText).filter(Boolean))];
    if (safe.length < 2 || safe.length > config.maxButtonsPerTabGroup || ut.length < 2) return;
    const labelsKey = ut.join('|').toLowerCase();
    if (!labelsKey) return;
    const headingCtx = getNearestHeadingText(c);
    const verticalPos = Math.round(c.getBoundingClientRect().top + window.scrollY);
    const sig = `${labelsKey}|${headingCtx}|${verticalPos}`;
    if (groups.some((g) => g.signature === sig)) return;
    safe.forEach((b) => used.add(b));
    groups.push({ container: c, buttons: safe, reason, signature: sig });
  };
  root.querySelectorAll('[role="tablist"]').forEach((tl) => {
    if (isInsideDangerousNavigationArea(tl)) return;
    push(tl, getTabGroupButtons(tl, config), 'role=tablist');
  });
  const cands = getAllPotentialButtons(root, config).filter(
    (b) =>
      !used.has(b) &&
      getButtonText(b) &&
      isDiscoverablyVisible(b) &&
      !isProbablyUnsafeTabButton(b, config),
  );
  const byP = new Map<HTMLElement, HTMLElement[]>();
  cands.forEach((b) => {
    const p = b.parentElement;
    if (!p || isInsideDangerousNavigationArea(p)) return;
    if (!byP.has(p)) byP.set(p, []);
    byP.get(p)!.push(b);
  });
  byP.forEach((bs, p) => {
    const fb = bs.filter((b) => {
      const t = getButtonText(b);
      return t.length >= config.minTabButtonTextLength && t.length <= config.maxTabButtonTextLength;
    });
    if (fb.length < 2) return;
    const allBtn = fb.every((b) => {
      const tp = cleanInline(b.getAttribute('type') || 'button').toLowerCase();
      return tp === 'button' || b.getAttribute('role') === 'tab';
    });
    if (!allBtn && !hasTabLikeAttributes(fb)) return;
    push(p, fb, 'same-parent-buttons');
  });
  return groups.slice(0, config.maxTabGroups);
};

export const findTabRoot = (g: TabGroup): Element => {
  let root: Element = g.container;
  let cand: Element | null = root;
  for (let i = 0; i < 7; i++) {
    if (!cand || cand === document.body) break;
    const t = getVisibleText(cand);
    const bt = g.buttons.map(getButtonText).join(' ');
    if (cleanBlock(t.replace(bt, '')).length > 40) root = cand;
    cand = cand.parentElement;
  }
  return root || g.container;
};

export const getPathFromRoot = (r: Element, t: Element): number[] => {
  const p: number[] = [];
  let n: Element | null = t;
  while (n && n !== r) {
    const par: Element | null = n.parentElement;
    if (!par) return [];
    p.unshift([...par.children].indexOf(n));
    n = par;
  }
  return p;
};

export const getNodeByPath = (r: Element, p: number[]): Element | null => {
  let n: Element | null = r;
  for (const i of p) {
    if (!n || !n.children || !n.children[i]) return null;
    n = n.children[i];
  }
  return n;
};

export const getTextFromCloneExcludingGroup = (r: Element, gc: Element): string => {
  const cl = r.cloneNode(true) as Element;
  const p = getPathFromRoot(r, gc);
  const gcl = getNodeByPath(cl, p);
  if (gcl) gcl.remove();
  return cleanBlock((cl as HTMLElement).innerText || cl.textContent || '');
};

// Enhanced findControlledPanel for Radix/shadcn tabs.
// Level 1: aria-controls → getElementById → data-state or isVisible.
// Level 2: sibling search near tablist — NO isVisible gate on data-state path.
export const findControlledPanel = (btn: Element): Element | null => {
  const controls = btn.getAttribute('aria-controls');
  if (controls) {
    const panel = document.getElementById(controls);
    if (panel) {
      const dataState = panel.getAttribute('data-state');
      if (dataState === 'active') return panel;
      if (isVisible(panel)) return panel;
    }
  }
  const searchContexts: Element[] = [];
  const tablist = btn.closest('[role="tablist"]');
  if (tablist && tablist.parentElement) searchContexts.push(tablist.parentElement);
  if (btn.parentElement && btn.parentElement.parentElement) {
    const gp = btn.parentElement.parentElement;
    if (!searchContexts.includes(gp)) searchContexts.push(gp);
  }
  for (const ctx of searchContexts) {
    // data-state="active" — trust it without isVisible (Radix may still have
    // the hidden attr mid-transition).
    const activePanel = ctx.querySelector('[role="tabpanel"][data-state="active"]');
    if (activePanel) return activePanel;
    const visiblePanel = ctx.querySelector('[role="tabpanel"]:not([hidden])');
    if (visiblePanel && isVisible(visiblePanel)) return visiblePanel;
  }
  return null;
};

// Expanded panel search — 3 levels for balanced, 4 for aggressive.
export const findPanelAfterGroup = (
  g: TabGroup,
  root: Element,
  config: ResolvedConfig,
): Element | null => {
  const gc = g.container;

  if (config.tabPanelStrategy === 'balanced' || config.tabPanelStrategy === 'aggressive') {
    // Level 3: nextElementSibling of gc.
    let next = gc.nextElementSibling;
    while (next) {
      if (!isSkippable(next, config) && isVisible(next) && getVisibleText(next).length > 5) {
        return next;
      }
      next = next.nextElementSibling;
    }

    // Level 4: non-button CHILDREN of gc with visible text > 20 chars.
    // Covers shadcn/Radix where panel is inside the same container as buttons.
    for (const child of gc.children) {
      if (!child || child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.tagName === 'BUTTON' || child.getAttribute('role') === 'tab') continue;
      if (child.getAttribute('role') === 'tablist') continue;
      if (isSkippable(child, config)) continue;
      const ds = child.getAttribute('data-state');
      if (ds === 'active') return child;
      if (ds === 'inactive') continue;
      if (child.hasAttribute('hidden')) continue;
      if (!isVisible(child)) continue;
      const text = getVisibleText(child);
      if (text.length > 20) return child;
    }

    // Level 5: siblings of gc.parentElement that come after gc.
    // Covers cases where gc is the tablist and the panel is a sibling of gc's parent.
    if (gc.parentElement && gc.parentElement !== root && gc.parentElement !== document.body) {
      const parent = gc.parentElement;
      let foundGc = false;
      for (const sibling of parent.children) {
        if (sibling === gc) {
          foundGc = true;
          continue;
        }
        if (!foundGc) continue;
        if (sibling.tagName === 'BUTTON' || sibling.getAttribute('role') === 'tab') continue;
        if (isSkippable(sibling, config)) continue;
        const ds = sibling.getAttribute('data-state');
        if (ds === 'active') return sibling;
        if (ds === 'inactive') continue;
        if (sibling.hasAttribute('hidden')) continue;
        if (!isVisible(sibling)) continue;
        const text = getVisibleText(sibling);
        if (text.length > 20) return sibling;
      }
    }
  }

  // Aggressive: broad querySelectorAll fallback.
  if (config.tabPanelStrategy === 'aggressive') {
    const cands = [
      ...root.querySelectorAll('section, article, div, ul, ol, p, table, pre, [role="tabpanel"]'),
    ].filter(
      (e) =>
        e !== gc &&
        !gc.contains(e) &&
        !e.contains(gc) &&
        isVisible(e) &&
        Boolean(gc.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        getVisibleText(e).length >= 10,
    );
    return cands[0] || null;
  }

  return null;
};

export const discoverDropdownButtons = (config: ResolvedConfig): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"], [role="combobox"]')]
    .filter(
      (b) =>
        isDropdownButton(b) &&
        isClickablyVisible(b) &&
        !isInsideDangerousNavigationArea(b) &&
        !b.closest('form') &&
        !(b as HTMLButtonElement).disabled,
    )
    .slice(0, config.maxDropdownButtons);

export const findVisibleDropdownPanel = (btn: Element): Element | null => {
  const cp = findControlledPanel(btn);
  if (cp) return cp;
  const cands = [
    ...document.querySelectorAll(
      '[role="menu"], [role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-select-content], [cmdk-list]',
    ),
  ].filter(
    (e) => isVisible(e) && cleanBlock((e as HTMLElement).innerText || e.textContent || '').length > 0,
  );
  return cands[cands.length - 1] || null;
};

// --- Tab capture (Section 33) ---

// Sequence-aware text delta extraction. Set-based line comparison loses shared
// lines like `import asyncio` across different code examples, so fenced code
// blocks are compared as whole units; set-diff applies only to plain text.
export const extractTextDelta = (beforeText: string, afterText: string): string => {
  if (!beforeText || !afterText) return '';
  if (beforeText === afterText) return '';

  // Strategy 1: extract fenced code blocks and compare as whole units.
  const extractFenced = (text: string): string[] => {
    const blocks: string[] = [];
    const regex = /^```[\s\S]*?^```/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) blocks.push(match[0].trim());
    return blocks;
  };

  const beforeFenced = extractFenced(beforeText);
  const afterFenced = extractFenced(afterText);
  const beforeFencedSet = new Set(beforeFenced);
  const newCodeBlocks = afterFenced.filter((block) => !beforeFencedSet.has(block));

  // Strategy 2: line-based diff for non-code text.
  const stripFenced = (text: string): string => text.replace(/^```[\s\S]*?^```/gm, '').trim();
  const beforePlain = stripFenced(beforeText);
  const afterPlain = stripFenced(afterText);

  const beforeLines = new Set(
    beforePlain.split('\n').map((l) => l.trim()).filter(Boolean),
  );
  const afterLines = afterPlain.split('\n').map((l) => l.trim()).filter(Boolean);
  const newPlainLines = afterLines.filter((line) => !beforeLines.has(line));

  // Merge lone `-` markers with the following line to form proper list items.
  const merged: string[] = [];
  for (let i = 0; i < newPlainLines.length; i++) {
    if (newPlainLines[i] === '-' && i + 1 < newPlainLines.length && newPlainLines[i + 1] !== '-') {
      merged.push(`- ${newPlainLines[i + 1]}`);
      i++;
    } else if (newPlainLines[i] === '-') {
      continue;
    } else {
      merged.push(newPlainLines[i]);
    }
  }

  const parts: string[] = [];
  if (merged.length) parts.push(merged.join('\n'));
  if (newCodeBlocks.length) parts.push(newCodeBlocks.join('\n\n'));

  return parts.join('\n\n');
};

export const makeTabSignature = (text: string | null | undefined): string => {
  const t = String(text || '');
  return t.slice(0, 200) + '||' + t.slice(-200);
};

export const captureCurrentTabPanel = async (
  ctx: ExtractContext,
  btn: HTMLElement,
  group: TabGroup,
  root: Element,
  beforeText: string,
  afterText: string,
): Promise<TabPanelCapture | null> => {
  const { config, state } = ctx;
  const cp = findControlledPanel(btn);
  const panel = cp || findPanelAfterGroup(group, root, config);

  if (panel) {
    const ls = renderNode(ctx, panel, 1, {
      expandTabs: false,
      expandDropdowns: false,
      includeRegionMarkers: false,
      skipCapturedTabPanels: false,
      skipCapturedDropdownPanels: false,
    });
    const j = normalizeMarkdownPreserveCode(ls.join('\n'));
    if (j) {
      const sig = makeTabSignature(j);
      if (state.capturedTabPanelTextSignatures.has(sig)) {
        state.capturedTabPanelElements.add(panel);
        return null;
      }
      state.capturedTabPanelTextSignatures.add(sig);
      state.capturedTabPanelElements.add(panel);
      return {
        lines: j.slice(0, config.maxTabPanelChars).split('\n'),
        source: cp ? 'aria-controls' : 'panel-after-group',
      };
    }
  }

  // Level 6: content delta detection. If visible text changed after the tab
  // click, the difference IS the tab content.
  if (beforeText && afterText && beforeText !== afterText) {
    const delta = extractTextDelta(beforeText, afterText);
    if (delta && delta.length > 20) {
      // Sanity: delta should not be too large (> 50% of page = probably wrong).
      if (
        state.baselineBodyText.length > 0 &&
        delta.length > state.baselineBodyText.length * config.tabFallbackMaxBodyRatio
      ) {
        ctx.progress('tabs', `tab content delta too large (${delta.length} chars), skipping`, 'warn');
      } else {
        const sig = makeTabSignature(delta);
        if (!state.capturedTabPanelTextSignatures.has(sig)) {
          state.capturedTabPanelTextSignatures.add(sig);
          return { text: delta.slice(0, config.maxTabPanelChars), source: 'content-delta' };
        }
      }
    }
  }

  // Level 7: clone-based fallback with sanity check.
  if (!cp && config.tabPanelStrategy !== 'safe') {
    const ft = getTextFromCloneExcludingGroup(root, group.container);
    if (ft && ft.length > 5) {
      if (
        state.baselineBodyText.length > 0 &&
        ft.length > state.baselineBodyText.length * config.tabFallbackMaxBodyRatio
      ) {
        ctx.progress(
          'tabs',
          `tab fallback too large (${ft.length} chars = ${((ft.length / state.baselineBodyText.length) * 100).toFixed(0)}% of page), skipping`,
          'warn',
        );
        return null;
      }
      const sig = makeTabSignature(ft);
      if (state.capturedTabPanelTextSignatures.has(sig)) return null;
      state.capturedTabPanelTextSignatures.add(sig);
      return { text: ft.slice(0, config.maxTabPanelChars), source: 'root-without-tab-buttons' };
    }
  }

  return null;
};

export const getActiveButtonIndex = (bs: HTMLElement[]): number => {
  const ia = bs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
  if (ia >= 0) return ia;
  const is = bs.findIndex(
    (b) =>
      /active|selected|current|primary|bg-primary/i.test(b.className || '') ||
      /active|selected|current/i.test(b.getAttribute('data-state') || ''),
  );
  return is >= 0 ? is : 0;
};

export const annotateTabButtons = (ctx: ExtractContext, gs: TabGroup[]): void => {
  let idx = 0;
  gs.forEach((g, gi) =>
    g.buttons.forEach((b) => {
      if (!b.dataset.aiExporterButtonId) {
        idx++;
        b.dataset.aiExporterButtonId = `tab-g${gi + 1}-b${idx}`;
        ctx.state.taggedExporterAttrElements.add(b);
      }
      ctx.state.knownTabButtonIds.add(b.dataset.aiExporterButtonId);
    }),
  );
};

export const annotateDropdownButtons = (ctx: ExtractContext, bs: HTMLElement[]): void =>
  bs.forEach((b, i) => {
    if (!b.dataset.aiExporterDropdownId) {
      b.dataset.aiExporterDropdownId = `dropdown-${i + 1}`;
      ctx.state.taggedExporterAttrElements.add(b);
    }
  });

export const extractTabPanels = async (ctx: ExtractContext): Promise<void> => {
  const { config, state } = ctx;
  if (!config.extractTabs || !ctx.flags.allowClickTabs) return;
  const gs = discoverTabGroups(ctx);
  annotateTabButtons(ctx, gs);
  ctx.progress('tabs', `discovered ${gs.length} tab group(s)`);

  for (const g of gs) {
    const root = findTabRoot(g);
    const activeIndex = getActiveButtonIndex(g.buttons);
    const activeButton = g.buttons[activeIndex];
    let aborted = false;

    // ---------------------------------------------------------------------
    // PHASE 1: pre-capture the initially active tab. Clicking the active tab
    // doesn't change the DOM, so content-delta won't work. Strategy: try
    // direct panel detection first; if it fails, cycle-away-and-back.
    // ---------------------------------------------------------------------
    if (activeButton) {
      const activeBid = activeButton.dataset.aiExporterButtonId;
      const activeLabel = getButtonText(activeButton);

      if (activeBid && activeLabel) {
        resetComputedStyleCache();
        let captured = await captureCurrentTabPanel(ctx, activeButton, g, root, '', '');

        if (!captured) {
          // Cycle-away-and-back: click a different tab, then click back.
          const otherIndex = g.buttons.findIndex(
            (b, i) => i !== activeIndex && !isProbablyUnsafeTabButton(b, config),
          );

          if (otherIndex >= 0) {
            const otherButton = g.buttons[otherIndex];
            try {
              await clickAndWait(otherButton, root, config.tabClickWaitMs, config.tabSettleMs);

              if (config.abortTabCaptureOnUrlDrift && isUrlDrifted(state)) {
                const restored = await tryRestoreUrl(state);
                if (!restored) {
                  aborted = true;
                }
              }

              if (!aborted) {
                resetComputedStyleCache();
                const textWhileAway = getVisibleText(root);

                await clickAndWait(activeButton, root, config.tabClickWaitMs, config.tabSettleMs);
                resetComputedStyleCache();
                const textAfterReturn = getVisibleText(root);

                captured = await captureCurrentTabPanel(
                  ctx,
                  activeButton,
                  g,
                  root,
                  textWhileAway,
                  textAfterReturn,
                );
              }
            } catch (e) {
              ctx.progress(
                'tabs',
                `cycle-away-and-back failed for active tab "${activeLabel}": ${String(e)}`,
                'warn',
              );
              try {
                await clickAndWait(activeButton, root, config.tabClickWaitMs, config.tabSettleMs);
              } catch {
                // active tab restore failed — continue
              }
            }
          }
        }

        if (captured) {
          const pt = normalizeMarkdownPreserveCode(
            captured.text || (captured.lines ? captured.lines.join('\n') : ''),
          );
          if (pt) {
            state.tabPanelsByButtonId.set(activeBid, { label: activeLabel, ...captured });
            ctx.appendix.capturedTabs.push({ label: activeLabel, source: captured.source });
            ctx.progress('tabs', `active tab "${activeLabel}" captured (source: ${captured.source})`);

            // Mark the panel DOM element to prevent duplicate rendering in the
            // main flow: the active panel is currently visible, so the finders
            // should locate it.
            resetComputedStyleCache();
            const panelEl = findControlledPanel(activeButton) || findPanelAfterGroup(g, root, config);
            if (panelEl) {
              state.capturedTabPanelElements.add(panelEl);
            }
          }
        } else {
          ctx.progress('tabs', `active tab "${activeLabel}" panel not captured (all methods failed)`, 'warn');
        }
      }
    }

    if (aborted) continue;

    // ---------------------------------------------------------------------
    // PHASE 2: capture remaining (non-active) tabs via content-delta.
    // ---------------------------------------------------------------------
    for (const btn of g.buttons) {
      const label = getButtonText(btn);
      const bid = btn.dataset.aiExporterButtonId;
      if (!bid || !label) continue;

      // Skip the active tab (already captured in Phase 1).
      if (bid === activeButton?.dataset?.aiExporterButtonId && state.tabPanelsByButtonId.has(bid)) {
        continue;
      }

      try {
        const beforeText = getVisibleText(root);
        await clickAndWait(btn, root, config.tabClickWaitMs, config.tabSettleMs);

        if (config.abortTabCaptureOnUrlDrift && isUrlDrifted(state)) {
          ctx.progress('tabs', `URL drifted after tab "${label}"`, 'warn');
          if (!(await tryRestoreUrl(state))) {
            aborted = true;
            break;
          }
        }

        resetComputedStyleCache();
        const afterText = getVisibleText(root);

        const cp = await captureCurrentTabPanel(ctx, btn, g, root, beforeText, afterText);
        if (!cp) continue;

        const pt = normalizeMarkdownPreserveCode(cp.text || (cp.lines ? cp.lines.join('\n') : ''));
        if (!pt) continue;

        state.tabPanelsByButtonId.set(bid, { label, ...cp });
        ctx.appendix.capturedTabs.push({ label, source: cp.source });
      } catch (e) {
        ctx.progress('tabs', `failed tab "${label}": ${String(e)}`, 'warn');
      }
    }

    // Restore active tab at the end.
    if (!aborted && activeButton) {
      try {
        await clickAndWait(activeButton, root, config.tabClickWaitMs, config.tabSettleMs);
        resetComputedStyleCache();
      } catch {
        // restore failed — page stays on the last clicked tab
      }
    }
  }
};

// --- Dropdown capture (Section 34) ---

export const captureDropdownPanel = async (ctx: ExtractContext, btn: HTMLElement): Promise<void> => {
  const { config, state } = ctx;
  const label = getButtonFallbackLabel(btn);
  const did = btn.dataset.aiExporterDropdownId;
  if (!did) return;
  try {
    const we = btn.getAttribute('aria-expanded') === 'true';
    if (!we) await clickAndWait(btn, document.body, config.dropdownClickWaitMs, config.dropdownSettleMs);
    const panel = findVisibleDropdownPanel(btn);
    if (panel) {
      const ls = renderNode(ctx, panel, 1, {
        expandTabs: false,
        expandDropdowns: false,
        includeRegionMarkers: false,
        skipCapturedTabPanels: false,
        skipCapturedDropdownPanels: false,
      });
      const j = normalizeMarkdownPreserveCode(ls.join('\n'));
      if (j) {
        state.capturedDropdownPanelElements.add(panel);
        state.dropdownPanelsByButtonId.set(did, {
          label,
          lines: j.slice(0, config.maxDropdownPanelChars).split('\n'),
          source: 'dropdown-panel',
        });
      }
    }
    if (!we) {
      pressEscape();
      await sleep(80);
    }
  } catch (e) {
    ctx.progress('dropdowns', `dropdown "${label}" failed: ${String(e)}`, 'warn');
    pressEscape();
    await sleep(80);
  }
};

export const extractDropdownPanels = async (ctx: ExtractContext): Promise<void> => {
  if (!ctx.flags.allowDropdownClicks) return;
  const bs = discoverDropdownButtons(ctx.config);
  annotateDropdownButtons(ctx, bs);
  ctx.progress('dropdowns', `discovered ${bs.length} dropdown button(s)`);
  for (const b of bs) await captureDropdownPanel(ctx, b);
};
