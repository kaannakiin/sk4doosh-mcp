import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Guard: raw html is not enabled, and must not be. `rehype-raw` would let model
 * output — which is partly whatever the reader's own spreadsheet contains — put
 * live markup into this page. react-markdown escapes html by default, and its
 * default url transform already drops `javascript:` and `data:` hrefs.
 */
const PLUGINS = [remarkGfm];

/**
 * Guard: a table is the one block allowed to be wider than the column, so it
 * gets its own scroll container. Without it a wide reader result forces the
 * whole conversation to scroll sideways on a phone.
 *
 * Guard: each override names the attributes it forwards instead of spreading.
 * react-markdown hands every override the mdast node alongside the html props,
 * and spreading that onto a dom element makes React warn on each one it renders.
 */
const COMPONENTS: Components = {
  a: ({ children, href, title }) => (
    <a href={href} title={title} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }) => <pre className="max-h-104 overflow-auto rounded-lg border border-hairline bg-raised px-3.5 py-3 font-mono text-[0.8125rem] leading-relaxed [&_code]:font-[inherit]">{children}</pre>,
};

export interface MarkdownProps {
  readonly text: string;
  readonly live: boolean;
}

/**
 * Guard: memoized on the text alone. A streaming answer re-renders roughly
 * twenty times a second, and the parse plus reconcile is the whole cost of
 * rendering a turn — every other prop here is constant.
 *
 * Guard: the text is not split into separately memoized blocks. The obvious
 * split, on blank lines, cuts fenced code blocks that contain one and turns a
 * loose list into several lists — a correctness bug traded for a parse that is
 * already a few milliseconds.
 */
function MarkdownComponent({ text, live }: MarkdownProps) {
  return (
    <div className="chat-markdown" data-live={live ? "" : undefined}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownComponent);
