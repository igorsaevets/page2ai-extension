// Quality metrics and fallbacks: main-render-to-body ratio check, technical
// completeness (<pre> count, code-group tablists), visible-text and noscript
// fallbacks for under-extracted pages.
// Ported from Rev-032v2 prototype (Section 40 + technical metrics from 41).

import { cleanBlock, cleanInline } from './utils';
import type { AppendixData, QualityRatioStatus, ResolvedConfig } from '../types';

export interface QualityMetricsBlock {
  lines: string[];
  ratio: number;
  ratioStatus: QualityRatioStatus;
}

export const buildQualityMetricsBlock = (
  config: ResolvedConfig,
  appendix: AppendixData,
  mainRenderText: string,
  baselineText: string,
): QualityMetricsBlock => {
  const ratio = baselineText.length > 0 ? mainRenderText.length / baselineText.length : 1;
  let status: QualityRatioStatus = 'OK';
  if (ratio < config.minMainRenderToBodyRatio) status = 'UNDER-EXTRACTED';
  else if (ratio > config.maxMainRenderToBodyRatio) status = 'OVER-EXTRACTED-NOISE';
  if (!config.qualityCheckEnabled) return { lines: [], ratio, ratioStatus: status };
  const ls = [
    `<!-- AI: QUALITY METRICS -->`,
    `<!-- main_render_chars: ${mainRenderText.length} -->`,
    `<!-- body_inner_text_chars (baseline): ${baselineText.length} -->`,
    `<!-- main_to_body_ratio: ${ratio.toFixed(3)} -->`,
    `<!-- ratio_status: ${status} -->`,
    `<!-- profile: ${config.activeProfile} -->`,
    `<!-- headings: ${appendix.headings} -->`,
    `<!-- links: ${appendix.links} -->`,
    `<!-- images: ${appendix.images} -->`,
    `<!-- forms: ${appendix.forms.length} -->`,
    `<!-- iframes: ${appendix.iframes.length} -->`,
    `<!-- code_blocks: ${appendix.codeBlocks} -->`,
    `<!-- captured_tabs: ${appendix.capturedTabs.length} -->`,
    `<!-- footer_links: ${appendix.footerLinks.length} -->`,
  ];
  if (status === 'OVER-EXTRACTED-NOISE') {
    ls.push(
      `<!-- WARNING: main render is ${ratio.toFixed(2)}x of body innerText. -->`,
      `<!-- Consider: aggressiveCleanup=true, stripNoisyAttributesInLinkText=true, filterDecorativeImages=true. -->`,
    );
  } else if (status === 'UNDER-EXTRACTED') {
    ls.push(`<!-- WARNING: main render captured only ${(ratio * 100).toFixed(1)}% of baseline. -->`);
  }
  ls.push('');
  return { lines: ls, ratio, ratioStatus: status };
};

export interface TechnicalCompletenessBlock {
  lines: string[];
  domPreCount: number;
  codeGroupTablists: number;
}

// Technical completeness metrics — catches code block loss.
export const buildTechnicalCompletenessBlock = (
  config: Pick<ResolvedConfig, 'qualityCheckEnabled'>,
): TechnicalCompletenessBlock => {
  const allPre = [...document.querySelectorAll('pre')];
  const codeGroupTabLists = [...document.querySelectorAll('[role="tablist"]')].filter((tl) => {
    const text = cleanInline((tl as HTMLElement).innerText || tl.textContent || '');
    return /\b(Python|TypeScript|JavaScript|npm|yarn|pnpm|bash|curl|Node|Ruby|Go|Java|PHP|C#|Swift|Kotlin|Rust)\b/i.test(
      text,
    );
  });
  const domPreCount = allPre.length;
  if (!config.qualityCheckEnabled) {
    return { lines: [], domPreCount, codeGroupTablists: codeGroupTabLists.length };
  }
  const lines = [
    '<!-- AI: TECHNICAL COMPLETENESS METRICS -->',
    `<!-- dom_pre_elements: ${domPreCount} -->`,
    `<!-- code_group_tablists: ${codeGroupTabLists.length} -->`,
  ];
  if (domPreCount >= 4) {
    lines.push(`<!-- NOTE: ${domPreCount} <pre> elements in DOM. Verify code_blocks count. -->`);
  }
  if (codeGroupTabLists.length >= 2) {
    lines.push(`<!-- NOTE: ${codeGroupTabLists.length} code-group tablists detected. -->`);
  }
  lines.push('');
  return { lines, domPreCount, codeGroupTablists: codeGroupTabLists.length };
};

export const buildVisibleTextFallback = (
  config: Pick<ResolvedConfig, 'qualityCheckEnabled' | 'minMainRenderToBodyRatio'>,
  mainRenderText: string,
  baselineText: string,
): string[] => {
  if (!config.qualityCheckEnabled || baselineText.length < 500) return [];
  const r = mainRenderText.length / baselineText.length;
  if (r >= config.minMainRenderToBodyRatio) return [];
  return [
    '',
    `<!-- AI: VISIBLE TEXT FALLBACK START (${(r * 100).toFixed(1)}% captured) -->`,
    '',
    baselineText,
    '',
    '<!-- AI: VISIBLE TEXT FALLBACK END -->',
    '',
  ];
};

export const buildNoscriptFallback = (
  config: Pick<
    ResolvedConfig,
    'emitNoscriptFallback' | 'noscriptOnlyIfMainRenderShort' | 'minMainRenderToBodyRatio'
  >,
  mainRenderText: string,
  baselineText: string,
): string[] => {
  if (!config.emitNoscriptFallback) return [];
  const ns = [...document.querySelectorAll('noscript')];
  if (!ns.length) return [];
  const isShort =
    baselineText.length > 500 &&
    mainRenderText.length / baselineText.length < config.minMainRenderToBodyRatio;
  if (config.noscriptOnlyIfMainRenderShort && !isShort) return [];
  const combined = ns
    .map((e) => cleanBlock(e.textContent || ''))
    .filter(Boolean)
    .join('\n\n');
  if (!combined) return [];
  return [
    '',
    '<!-- AI: NOSCRIPT FALLBACK START -->',
    '',
    combined,
    '',
    '<!-- AI: NOSCRIPT FALLBACK END -->',
    '',
  ];
};
