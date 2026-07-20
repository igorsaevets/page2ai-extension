// MDX → clean Markdown converter for official .md files served by
// Mintlify/Docusaurus-style docs (JSX components, nested indentation).
// Ported from Rev-032v2 prototype (Section 36, convertMdxToMarkdown).

export const convertMdxToMarkdown = (text: string | null | undefined, origin?: string): string => {
  let md = String(text || '');
  const resolvedOrigin = origin ?? globalThis.location?.origin ?? '';

  // 1) Remove JSX attributes from code fences: ```python Python theme={null} → ```python
  md = md.replace(/^(\s*```\w*)\s+\w+\s+theme=\{null\}\s*$/gm, '$1');
  md = md.replace(/^(\s*```\w*)\s+theme=\{null\}\s*$/gm, '$1');

  // 2) <Note> → blockquote
  md = md.replace(/<Note>\s*/g, '> **Note:** ');
  md = md.replace(/\s*<\/Note>/g, '\n');

  // 3) <Warning> → blockquote
  md = md.replace(/<Warning>\s*/g, '> **Warning:** ');
  md = md.replace(/\s*<\/Warning>/g, '\n');

  // 4) <Tip> → blockquote
  md = md.replace(/<Tip>\s*/g, '> **Tip:** ');
  md = md.replace(/\s*<\/Tip>/g, '\n');

  // 5) <Info> → blockquote
  md = md.replace(/<Info>\s*/g, '> **Info:** ');
  md = md.replace(/\s*<\/Info>/g, '\n');

  // 6) <CodeGroup> — just strip wrapper, keep children
  md = md.replace(/<\/?CodeGroup>/g, '');

  // 7) <Tabs> / <Tab title="X"> → **X:**
  md = md.replace(/<Tabs>\s*/g, '');
  md = md.replace(/\s*<\/Tabs>/g, '\n');
  md = md.replace(/<Tab\s+title="([^"]*)"[^>]*>\s*/g, '\n**$1:**\n\n');
  md = md.replace(/\s*<\/Tab>/g, '\n');

  // 8) <Steps> / <Step title="X"> → **Step: X**
  md = md.replace(/<Steps>\s*/g, '');
  md = md.replace(/\s*<\/Steps>/g, '\n');
  md = md.replace(/<Step\s+title="([^"]*)"[^>]*>\s*/g, '\n**$1**\n\n');
  md = md.replace(/\s*<\/Step>/g, '\n');

  // 9) <CardGroup> — strip wrapper
  md = md.replace(/<CardGroup[^>]*>\s*/g, '');
  md = md.replace(/\s*<\/CardGroup>/g, '\n');

  // 10) <Card title="X" icon="Y" href="Z"> text </Card> → - [**X**](Z) — text
  md = md.replace(
    /<Card\s+title="([^"]*)"[^>]*href="([^"]*)"[^>]*>\s*([\s\S]*?)\s*<\/Card>/g,
    (_match, title: string, href: string, body: string) => `- [**${title}**](${href}) — ${body.trim()}`,
  );
  // Cards without href
  md = md.replace(
    /<Card\s+title="([^"]*)"[^>]*>\s*([\s\S]*?)\s*<\/Card>/g,
    (_match, title: string, body: string) => `- **${title}** — ${body.trim()}`,
  );

  // 11) <Accordion> / <AccordionGroup>
  md = md.replace(/<AccordionGroup>\s*/g, '');
  md = md.replace(/\s*<\/AccordionGroup>/g, '\n');
  md = md.replace(/<Accordion\s+title="([^"]*)"[^>]*>\s*/g, '\n<details><summary>$1</summary>\n\n');
  md = md.replace(/\s*<\/Accordion>/g, '\n</details>\n');

  // 12) Any remaining simple self-closing JSX tags
  md = md.replace(/<[A-Z][a-zA-Z]*\s*\/>/g, '');

  // 13) Make relative links absolute
  md = md.replace(/\]\(\/([\w/-]+)/g, `](${resolvedOrigin}/$1`);

  // 14) Normalize indentation: strip MDX nesting whitespace.
  // MDX content is deeply indented (2-8 spaces) because of nesting inside
  // <Steps><Step><Tabs><Tab>. After removing tags, content retains original indent.
  // Strategy: for each code block, find minimum indent and strip it.
  // For non-code lines, strip up to 6 leading spaces (MDX nesting).
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;
  let codeBuffer: string[] = [];

  const flushCode = () => {
    if (!codeBuffer.length) return;
    const contentLines = codeBuffer.slice(1, -1);
    const indents = contentLines
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        const m = l.match(/^(\s*)/);
        return m ? m[1].length : 0;
      });
    const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

    out.push(codeBuffer[0].trim());
    for (const l of contentLines) {
      if (l.trim().length === 0) out.push('');
      else out.push(l.substring(minIndent));
    }
    out.push('```');
    codeBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inFence && /^`{3,}/.test(trimmed)) {
      inFence = true;
      codeBuffer = [line];
      continue;
    }

    if (inFence) {
      codeBuffer.push(line);
      if (/^\s*`{3,}\s*$/.test(line)) {
        inFence = false;
        flushCode();
      }
      continue;
    }

    out.push(line.replace(/^ {2,6}(?=\S)/, ''));
  }

  if (codeBuffer.length) {
    codeBuffer.forEach((l) => out.push(l.trim()));
  }

  md = out.join('\n');

  // 15) Clean up excessive blank lines
  md = md.replace(/\n{4,}/g, '\n\n\n');

  return md;
};
