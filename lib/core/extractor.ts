// Extraction orchestrator: page preparation, official-markdown short path,
// tab/dropdown capture, main render, post-processing and quality reporting.
// Ported from Rev-032v2 prototype (Sections 14, 25, 37-39, 41).
// Unlike the prototype (DevTools script that downloaded a file), this returns
// an ExtractResult; the extension shell decides clipboard vs download.

import {
  absUrl,
  cleanBlock,
  cleanInline,
  escapeMd,
  isWordPressNoiseLink,
  sleep,
  slugify,
} from './utils';
import {
  getMeta,
  getPrimaryContentRoot,
  isInsideDangerousNavigationArea,
  resetComputedStyleCache,
} from './dom';
import { deriveFlags, resolveConfig } from './profiles';
import { renderNode } from './html-to-md';
import {
  dedupeConsecutiveDuplicateLines,
  normalizeMarkdownPreserveCode,
  postProcessMarkdown,
} from './md-postprocess';
import { convertMdxToMarkdown } from './mdx-processor';
import { fetchOfficialMd } from './llms-txt';
import { extractDropdownPanels, extractTabPanels } from './tab-handler';
import { buildStructuredDataSection, extractInternalStateBlock } from './structured-data';
import {
  buildNoscriptFallback,
  buildQualityMetricsBlock,
  buildTechnicalCompletenessBlock,
  buildVisibleTextFallback,
} from './quality-gate';
import type {
  AppendixData,
  ExtractContext,
  ExtractOptions,
  ExtractResult,
  ExtractorState,
  ProgressCallback,
  QualityReport,
  ResolvedConfig,
} from '../types';

const EXTRACTOR_NAME = 'Page2MD';
const EXTRACTOR_REVISION = 'Rev-032v2-TS';

export const createAppendix = (): AppendixData => ({
  forms: [],
  iframes: [],
  footerLinks: [],
  capturedTabs: [],
  images: 0,
  headings: 0,
  links: 0,
  codeBlocks: 0,
});

export const createExtractorState = (): ExtractorState => ({
  tabPanelsByButtonId: new Map(),
  dropdownPanelsByButtonId: new Map(),
  capturedTabPanelElements: new WeakSet(),
  capturedDropdownPanelElements: new WeakSet(),
  capturedTabPanelTextSignatures: new Set(),
  knownTabButtonIds: new Set(),
  touchedDetailsElements: [],
  taggedExporterAttrElements: new Set(),
  originalScrollPosition: null,
  baselineBodyText: '',
  initialUrl: location.href,
});

// --- Details expand / restore (Section 25) ---

export const expandDetailsElementsSafely = (ctx: ExtractContext): void => {
  if (!ctx.flags.allowOpenDetails) return;
  const root = getPrimaryContentRoot();
  root.querySelectorAll<HTMLDetailsElement>('details').forEach((det) => {
    if (isInsideDangerousNavigationArea(det)) return;
    ctx.state.touchedDetailsElements.push({
      el: det,
      hadOpen: det.hasAttribute('open'),
      originalName: det.getAttribute('name'),
      hadName: det.hasAttribute('name'),
    });
    if (det.hasAttribute('name')) det.removeAttribute('name');
    det.open = true;
    det.dataset.aiExporterDetailsOpened = 'true';
    ctx.state.taggedExporterAttrElements.add(det);
  });
};

export const restoreDetailsElementsSafely = (ctx: ExtractContext): void => {
  if (!ctx.config.restoreDetailsAfterExport) return;
  ctx.state.touchedDetailsElements.forEach((r) => {
    const d = r.el;
    if (!d || !d.isConnected) return;
    if (r.hadName) d.setAttribute('name', r.originalName || '');
    else d.removeAttribute('name');
    if (r.hadOpen) d.setAttribute('open', '');
    else d.removeAttribute('open');
    delete d.dataset.aiExporterDetailsOpened;
  });
};

// --- Lazy-load activation (Section 14) ---

export const activateLazyLoad = async (ctx: ExtractContext): Promise<void> => {
  const { config, state } = ctx;
  if (config.lazyLoadMode === 'none') return;
  state.originalScrollPosition = { x: window.scrollX, y: window.scrollY };
  try {
    if (config.lazyLoadMode === 'safe') {
      for (let i = 1; i <= Math.max(1, config.lazySafeViewports); i++) {
        try {
          window.scrollTo({ top: window.innerHeight * i, left: 0, behavior: 'instant' });
        } catch {
          window.scrollTo(0, window.innerHeight * i);
        }
        await sleep(config.lazyScrollWaitMs);
      }
    } else if (config.lazyLoadMode === 'full') {
      const th = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.documentElement.clientHeight,
      );
      const steps = Math.max(2, config.lazyScrollSteps);
      for (let i = 1; i <= steps; i++) {
        const target = Math.round((th * i) / steps);
        try {
          window.scrollTo({ top: target, left: 0, behavior: 'instant' });
        } catch {
          window.scrollTo(0, target);
        }
        await sleep(config.lazyScrollWaitMs);
      }
      try {
        window.scrollTo({
          top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
          left: 0,
          behavior: 'instant',
        });
      } catch {
        window.scrollTo(0, document.body.scrollHeight);
      }
    }
    await sleep(config.lazyScrollExtraIdleMs);
  } catch (e) {
    ctx.progress('lazy-load', `lazy-load scroll failed: ${String(e)}`, 'warn');
  }
};

export const restoreScrollPosition = (ctx: ExtractContext): void => {
  const { config, state } = ctx;
  if (!config.restoreScrollAfterExport || !state.originalScrollPosition) return;
  try {
    window.scrollTo({
      top: state.originalScrollPosition.y,
      left: state.originalScrollPosition.x,
      behavior: 'instant',
    });
  } catch {
    try {
      window.scrollTo(state.originalScrollPosition.x, state.originalScrollPosition.y);
    } catch {
      // scroll restore failed — leave the page as is
    }
  }
};

// --- Cleanup (Section 37) ---

export const cleanupExporterAttributes = (ctx: ExtractContext): void => {
  ctx.state.taggedExporterAttrElements.forEach((el) => {
    if (!el || !el.isConnected) return;
    delete el.dataset.aiExporterButtonId;
    delete el.dataset.aiExporterDropdownId;
    delete el.dataset.aiExporterDetailsOpened;
  });
  ctx.state.taggedExporterAttrElements.clear();
  document
    .querySelectorAll<HTMLElement>(
      '[data-ai-exporter-button-id],[data-ai-exporter-dropdown-id],[data-ai-exporter-details-opened]',
    )
    .forEach((el) => {
      delete el.dataset.aiExporterButtonId;
      delete el.dataset.aiExporterDropdownId;
      delete el.dataset.aiExporterDetailsOpened;
    });
};

// --- Frontmatter (Section 38) ---

export const buildFrontmatter = (
  ctx: ExtractContext,
  extras: Record<string, string | number> = {},
): string[] => {
  const { config, state } = ctx;
  const fm = [
    '---',
    `title: "${cleanInline(document.title).replace(/"/g, '\\"')}"`,
    `source: "${location.href}"`,
    `captured_at: "${new Date().toISOString()}"`,
    `language: "${document.documentElement.lang || 'unknown'}"`,
    `description: "${getMeta('meta[name="description"]').replace(/"/g, '\\"')}"`,
    `canonical: "${absUrl(document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '').replace(/"/g, '\\"')}"`,
  ];
  if (config.outputMode === 'debug') {
    fm.push(
      `extractor: "${EXTRACTOR_NAME}"`,
      `revision: "${EXTRACTOR_REVISION}"`,
      `profile: "${config.activeProfile}"`,
      `interaction_mode: "${config.interactionMode}"`,
      `lazy_load_mode: "${config.lazyLoadMode}"`,
      `tab_panel_strategy: "${config.tabPanelStrategy}"`,
      `visual_markers_mode: "${config.visualMarkersMode}"`,
      `tab_panels_captured: "${state.tabPanelsByButtonId.size}"`,
      `dropdown_panels_captured: "${state.dropdownPanelsByButtonId.size}"`,
    );
  }
  Object.entries(extras).forEach(([k, v]) => fm.push(`${k}: "${String(v).replace(/"/g, '\\"')}"`));
  fm.push('---', '');
  return fm;
};

// --- Appendix (Section 39) ---

export const buildAppendix = (ctx: ExtractContext): string[] => {
  const { config, appendix } = ctx;
  if (!config.emitAppendix) return [];
  const esc = (t: string | null | undefined): string =>
    escapeMd(t, config.stripNoisyAttributesInLinkText);
  const lines: string[] = [];
  let any = false;
  if (appendix.forms.length) {
    any = true;
    lines.push('### Forms (technical layer)', '');
    appendix.forms.forEach((f, i) => {
      lines.push(`- Form ${i + 1}${f.formName ? ` (${f.formName})` : ''}: \`${f.method}\` → ${f.action}`);
      if (f.visibleFields.length) {
        lines.push('   - Visible fields:');
        f.visibleFields.forEach((fld) => {
          const d = [
            `${fld.tag}/${fld.type}`,
            fld.name ? `name="${fld.name}"` : '',
            fld.label ? `label="${esc(fld.label)}"` : '',
            fld.placeholder ? `placeholder="${esc(fld.placeholder)}"` : '',
            fld.required ? 'required' : '',
            fld.autocomplete ? `autocomplete="${fld.autocomplete}"` : '',
          ]
            .filter(Boolean)
            .join(' / ');
          lines.push(`      - ${d}`);
        });
      }
      if (f.hiddenFields.length) {
        lines.push('   - Hidden fields (sanitized):');
        f.hiddenFields.forEach((fld) => {
          const vd = fld.sanitizedValue ? ` = ${fld.sanitizedValue}` : '';
          lines.push(`      - ${fld.name || '(unnamed)'}${vd}`);
        });
      }
    });
    lines.push('');
  }
  if (appendix.iframes.length) {
    any = true;
    lines.push('### Embedded iframes', '');
    appendix.iframes.forEach((f) =>
      lines.push(`- ${f.title ? `**${esc(f.title)}** — ` : ''}${f.src}`),
    );
    lines.push('');
  }
  if (appendix.capturedTabs.length) {
    any = true;
    lines.push('### Captured tab panels', '');
    appendix.capturedTabs.forEach((t) => lines.push(`- ${esc(t.label)} (source: ${t.source})`));
    lines.push('');
  }
  if (appendix.footerLinks.length) {
    any = true;
    lines.push('### Footer sitemap', '');
    const seen = new Set<string>();
    appendix.footerLinks.forEach((l) => {
      if (seen.has(l.href)) return;
      seen.add(l.href);
      if (isWordPressNoiseLink(l.href, config)) return;
      lines.push(`- [${esc(l.text)}](${l.href})`);
    });
    lines.push('');
  }
  if (!any) return [];
  return ['', '<!-- AI: APPENDIX START -->', '## Appendix', '', ...lines, '<!-- AI: APPENDIX END -->', ''];
};

export const buildFilename = (config: ResolvedConfig): string =>
  `${slugify(document.title)}.${config.fileExtension}`;

// --- Main pipeline (Section 41) ---

export const runExtractor = async (
  options: ExtractOptions = {},
  onProgress?: ProgressCallback,
): Promise<ExtractResult> => {
  const progress: ProgressCallback = onProgress || (() => undefined);
  const config = resolveConfig(options, progress);
  const flags = deriveFlags(config);
  const state = createExtractorState();
  const appendix = createAppendix();
  const ctx: ExtractContext = { config, flags, state, appendix, progress };

  try {
    progress('start', `profile="${config.activeProfile}"`);

    expandDetailsElementsSafely(ctx);
    await sleep(80);
    state.baselineBodyText = cleanBlock(document.body.innerText || document.body.textContent || '');

    const officialMd = await fetchOfficialMd(config, progress);
    let officialSupp: { url: string; markdown: string; ratio: number } | null = null;
    if (officialMd) {
      const ratio =
        state.baselineBodyText.length > 0
          ? officialMd.markdown.length / state.baselineBodyText.length
          : 1;
      if (ratio >= config.officialMarkdownMinRatio) {
        // Convert MDX components to clean Markdown before output.
        const cleanedMd = convertMdxToMarkdown(officialMd.markdown);
        const md = normalizeMarkdownPreserveCode(
          dedupeConsecutiveDuplicateLines(
            [
              ...buildFrontmatter(ctx, {
                official_markdown_source: officialMd.url,
                official_markdown_ratio: ratio.toFixed(3),
              }),
              `# ${cleanInline(document.title) || 'Untitled page'}`,
              '',
              cleanedMd,
            ].join('\n'),
            config,
          ),
        );
        progress('official-md', `using official markdown (ratio=${ratio.toFixed(3)})`);
        return {
          status: 'official-md',
          markdown: md,
          filename: buildFilename(config),
          profile: config.activeProfile,
          officialMarkdownUrl: officialMd.url,
          officialMarkdownRatio: ratio,
          tabsCaptured: 0,
          dropdownsCaptured: 0,
        };
      }
      officialSupp = { ...officialMd, ratio };
    }

    await activateLazyLoad(ctx);
    resetComputedStyleCache();
    await extractTabPanels(ctx);
    await extractDropdownPanels(ctx);
    resetComputedStyleCache();

    const sdLines = buildStructuredDataSection(config);
    const isLines = extractInternalStateBlock(config);
    const fm = buildFrontmatter(ctx);
    const bodyLines = renderNode(ctx, document.body, 0);
    const mrt = bodyLines.join('\n');

    const qm = buildQualityMetricsBlock(config, appendix, mrt, state.baselineBodyText);
    const tqm = buildTechnicalCompletenessBlock(config);
    const vtf = buildVisibleTextFallback(config, mrt, state.baselineBodyText);
    const nsf = buildNoscriptFallback(config, mrt, state.baselineBodyText);
    const apx = buildAppendix(ctx);

    const composed = [...fm, `# ${cleanInline(document.title) || 'Untitled page'}`, ''];
    if (config.structuredDataPosition === 'before-content' && sdLines.length) {
      composed.push(...sdLines);
    }
    if (isLines.length) composed.push(...isLines);
    composed.push('<!-- AI: PAGE CONTENT START -->', '', ...bodyLines, '', '<!-- AI: PAGE CONTENT END -->', '');
    if (vtf.length) composed.push(...vtf);
    if (nsf.length) composed.push(...nsf);
    if (officialSupp) {
      composed.push(
        '',
        `<!-- AI: SUPPLEMENTAL OFFICIAL MARKDOWN (ratio=${officialSupp.ratio.toFixed(3)}) -->`,
        `<!-- source: ${officialSupp.url} -->`,
        '',
        convertMdxToMarkdown(officialSupp.markdown),
        '',
      );
    }
    if (apx.length) composed.push(...apx);
    if (config.structuredDataPosition === 'after-content' && sdLines.length) {
      composed.push(...sdLines);
    }
    if (qm.lines.length) composed.push(...qm.lines);
    if (tqm.lines.length) composed.push(...tqm.lines);

    const md = postProcessMarkdown(composed.join('\n'), config, progress);

    const quality: QualityReport = {
      mainRenderChars: mrt.length,
      baselineChars: state.baselineBodyText.length,
      ratio: qm.ratio,
      ratioStatus: qm.ratioStatus,
      headings: appendix.headings,
      links: appendix.links,
      images: appendix.images,
      forms: appendix.forms.length,
      iframes: appendix.iframes.length,
      codeBlocks: appendix.codeBlocks,
      capturedTabs: appendix.capturedTabs.length,
      footerLinks: appendix.footerLinks.length,
      domPreCount: tqm.domPreCount,
      codeGroupTablists: tqm.codeGroupTablists,
    };

    progress(
      'done',
      `tabs: ${state.tabPanelsByButtonId.size}, dropdowns: ${state.dropdownPanelsByButtonId.size}, ` +
        `main=${mrt.length}, baseline=${state.baselineBodyText.length}, ratio=${qm.ratio.toFixed(3)}`,
    );

    return {
      status: 'ok',
      markdown: md,
      filename: buildFilename(config),
      profile: config.activeProfile,
      quality,
      tabsCaptured: state.tabPanelsByButtonId.size,
      dropdownsCaptured: state.dropdownPanelsByButtonId.size,
      ...(officialSupp ? { officialMarkdownUrl: officialSupp.url, officialMarkdownRatio: officialSupp.ratio } : {}),
    };
  } catch (error) {
    const err = error as Error;
    progress('error', `extractor crashed: ${String(err?.message || err)}`, 'error');
    let fallbackMd = '';
    if (config.enableFailSafeDownload) {
      fallbackMd = normalizeMarkdownPreserveCode(
        [
          '---',
          `title: "${cleanInline(document.title).replace(/"/g, '\\"')}"`,
          `source: "${location.href}"`,
          `captured_at: "${new Date().toISOString()}"`,
          `status: "fallback_export_after_crash"`,
          `error_name: "${cleanInline(err?.name || 'UnknownError').replace(/"/g, '\\"')}"`,
          `error_message: "${cleanInline(err?.message || String(error)).replace(/"/g, '\\"')}"`,
          '---',
          '',
          `# ${cleanInline(document.title) || 'Untitled page'}`,
          '',
          '<!-- AI: FALLBACK EXPORT START -->',
          '',
          cleanBlock(document.body.innerText || document.body.textContent || ''),
          '',
          '<!-- AI: FALLBACK EXPORT END -->',
          '',
        ].join('\n'),
      );
    }
    return {
      status: 'fallback-after-crash',
      markdown: fallbackMd,
      filename: `${slugify(document.title)}-fallback.${config.fileExtension}`,
      profile: config.activeProfile,
      tabsCaptured: state.tabPanelsByButtonId.size,
      dropdownsCaptured: state.dropdownPanelsByButtonId.size,
      error: { name: err?.name || 'UnknownError', message: err?.message || String(error) },
    };
  } finally {
    try {
      restoreDetailsElementsSafely(ctx);
    } catch {
      // ignore restore failure
    }
    try {
      cleanupExporterAttributes(ctx);
    } catch {
      // ignore cleanup failure
    }
    try {
      restoreScrollPosition(ctx);
    } catch {
      // ignore scroll restore failure
    }
  }
};
