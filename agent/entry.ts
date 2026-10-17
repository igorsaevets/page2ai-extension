// Page2AI agent script (BL-45, option C): the extension's own extractor as a plain page script, for AI agents
// that see a page through a browser automation tool (Chrome DevTools MCP, Playwright MCP) and need its Markdown,
// including pages behind a sign-in that a fetch-based tool cannot reach.
//
// It runs in the page's MAIN world, not in the extension's isolated world, so it uses no extension API at all.
// Progress goes into the returned object and never to the console: in the main world the page's own scripts
// read the console (error trackers record it as breadcrumbs). scripts/build-agent.mjs bundles this file into
// .output/agent/ in two shapes, see agent/README.md.

import { runExtractor } from '~/lib/core/extractor';
import type { ExtractOptions, ExtractResult, ProgressLevel } from '~/lib/types';

declare const __PAGE2AI_AGENT_VERSION__: string;

export interface AgentLogEntry {
  step: string;
  message: string;
  level: ProgressLevel;
}

export interface AgentResult extends ExtractResult {
  /** Build that produced this result: extension version + commit. */
  page2ai: string;
  url: string;
  title: string;
  log: AgentLogEntry[];
}

export const version: string = __PAGE2AI_AGENT_VERSION__;

const MAX_LOG_ENTRIES = 200;
let running = false;

const isPlainOptions = (v: unknown): v is ExtractOptions =>
  typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;

/**
 * Extract the current page. `options` is the same object the popup sends ({ profile }), optionally with
 * `overrides`; anything that is not a plain object (DevTools MCP passes element handles) means defaults.
 */
export const extract = async (options?: unknown): Promise<AgentResult> => {
  if (running) throw new Error('Page2AI: an extraction is already running in this page');
  running = true;
  const log: AgentLogEntry[] = [];
  try {
    const result = await runExtractor(isPlainOptions(options) ? options : {}, (step, message, level) => {
      if (log.length < MAX_LOG_ENTRIES) log.push({ step, message, level: level ?? 'info' });
    });
    return { page2ai: version, url: location.href, title: document.title, ...result, log };
  } finally {
    running = false;
  }
};
