# Page2AI: Use Cases and Adoption

Real-world use cases, adoption metrics, community feedback, and how Page2AI fits into the US AI developer stack. Updated regularly.

## Adoption metrics

Snapshot as of **2026-07-23** (Page2AI is 3 days old, so numbers will grow as the launch proceeds):

- Chrome Web Store installs: pending review
- CWS rating: not yet available
- GitHub stars: 0
- GitHub forks: 0
- npm dependents: N/A (LangChain-community loader planned)

## Users and applications

### AI development workflows

Page2AI targets developers building on these US-based AI platforms:

- **Anthropic Claude**. Extract API docs, model reference pages, cookbook examples into context windows.
- **OpenAI GPT**. Prepare knowledge base content for Assistants API and RAG.
- **Google Gemini**. Feed docs into Google AI Studio for grounding.
- **Meta Llama**. Prepare training / fine-tuning corpora from web sources.
- **xAI Grok**. API doc extraction for Grok integrations.
- **Mistral, Cohere**. Reference content preparation.

### RAG pipeline ingestion

The Markdown output plugs into RAG pipelines built with:

- LangChain (community document loader planned)
- LlamaIndex (community loader planned)
- Vercel AI SDK (recipe "Preparing RAG context with Page2AI" planned)
- OpenAI Agents SDK
- Anthropic MCP (Model Context Protocol) as a data source

### AI-native IDEs

Developers using Cursor, Windsurf, GitHub Copilot, Zed, and Continue use Page2AI to pull docs into chat contexts without leaving their editor.

### Personal knowledge management

Obsidian, Notion, Logseq, Roam, and Reflect users clip documentation and research papers.

## Citations

Page2AI has been mentioned or cited in:

_To be populated as PRs merge and community adoption grows._

Planned submissions:

- **Anthropic Cookbook** (github.com/anthropics/anthropic-cookbook). Recipe: "Preparing RAG context with Page2AI".
- **Vercel AI SDK Recipes** (ai-sdk.dev/resources/recipes).
- **LangChain-community**. Document loader.
- **kmaasrud/awesome-obsidian**. Browser extensions section. [PR open](https://github.com/kmaasrud/awesome-obsidian/pull/125).
- **spencerpauly/awesome-notion**. Web Clipper section. [PR open](https://github.com/spencerpauly/awesome-notion/pull/76).
- **themeselection/best-chrome-extensions**. Productivity section. [PR open](https://github.com/themeselection/best-chrome-extensions/pull/55).
- **swiftsimplify/awesome-open-source-ai-tools**. Tools section (submit after reaching 50 stars, which is their inclusion criterion).

## Community feedback

_Testimonials from public GitHub issues, Reddit posts, and HackerNews Show HN thread will be captured here as they arrive._

## Star history

<a href="https://star-history.com/#igorsaevets/page2ai-extension&Date">
  <img src="https://api.star-history.com/svg?repos=igorsaevets/page2ai-extension&type=Date" alt="Star History Chart">
</a>

## Zenodo archive

Page2AI will be archived on Zenodo for citable reference once v1.2.0 is tagged. The DOI will be added here.

## Fit with the US AI developer ecosystem

Page2AI is an open-source (MIT) contribution to the US-anchored AI developer infrastructure. Concretely:

**1. Reduces friction for US-based AI developers preparing context for LLMs.** Anthropic Claude, OpenAI GPT, Google Gemini, Meta Llama, xAI Grok all read Markdown better than raw HTML. Every reference doc, blog post, or research page becomes clean context in one hotkey. Practically: a Cursor user reading Anthropic's extended-thinking docs can pull them straight into a chat with the model that wrote them.

**2. Built on US open standards:**
- Chrome Extensions Manifest V3 (Google)
- WXT framework (open source, distributed via npm, MIT)
- CommonMark specification (widely-adopted Markdown)
- JSON-LD (W3C standard for structured metadata)
- `llms.txt` proposal (community standard for LLM-consumable content)

**3. Distributed via US-operated infrastructure:**
- Chrome Web Store (Google). Extension discovery, install, update.
- GitHub Releases (Microsoft). Source distribution, release automation.
- Zenodo (CERN with US collaboration). Citable archive.

**4. Interoperates with US AI-native tools:**
- Cursor IDE, GitHub Copilot, Windsurf, Zed
- Vercel AI SDK, LangChain, LlamaIndex
- Anthropic Claude Code, OpenAI Codex CLI

**5. Contributes back** via PRs into Anthropic Cookbook, Vercel AI SDK Recipes, LangChain-community, and community awesome-lists (see Citations section).

Page2AI is intended for daily use by AI engineers at US-based companies and research institutions building AI-augmented developer workflows. Every extraction runs locally, without transmitting user data, and produces structured input that reduces the friction of preparing context for retrieval-augmented generation, agent workflows, and knowledge base construction.

---

_This document is updated after significant adoption milestones. For source code and technical architecture, see [`README.md`](../README.md). For privacy policy, see [`PRIVACY.md`](../PRIVACY.md)._
