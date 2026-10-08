import React from 'react';

const blockStartPattern = /^(#{1,3})\s+|^[-*•]\s+|^\d+[.)]\s+|^>\s?/;

function renderInline(text: string, keyPrefix: string) {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={key} className="font-extrabold text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={key} className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[0.92em] text-cyan-200">
            {part.slice(1, -1)}
          </code>
        );
      }
      return <React.Fragment key={key}>{part}</React.Fragment>;
    });
}

export function FinanceChatAnswer({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push(
        <h4
          key={`heading-${index}`}
          className="mt-4 border-b border-slate-700/70 pb-1.5 text-sm font-extrabold text-indigo-200 first:mt-0"
        >
          {renderInline(heading[2], `heading-${index}`)}
        </h4>,
      );
      index += 1;
      continue;
    }

    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*•]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push(
        <ul key={`bullets-${index}`} className="my-2 space-y-1.5 pl-1">
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`} className="flex gap-2">
              <span aria-hidden="true" className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
              <span>{renderInline(item, `bullet-${index}-${itemIndex}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^\d+[.)]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push(
        <ol key={`steps-${index}`} className="my-2 space-y-2">
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`} className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-extrabold text-emerald-300">
                {itemIndex + 1}
              </span>
              <span>{renderInline(item, `step-${index}-${itemIndex}`)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = line.replace(/^>\s?/, '');
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="my-2 border-l-2 border-cyan-400/60 bg-cyan-500/5 px-3 py-2 text-slate-300"
        >
          {renderInline(quote, `quote-${index}`)}
        </blockquote>,
      );
      index += 1;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !blockStartPattern.test(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`} className="my-2 leading-6 text-slate-200 first:mt-0 last:mb-0">
        {renderInline(paragraph.join(' '), `paragraph-${index}`)}
      </p>,
    );
  }

  return <div className="min-w-0 break-words text-[13px] eb-tabular">{blocks}</div>;
}
