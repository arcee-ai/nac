// Markdown converter chain (all vendored, buildless, offline):
// markdown-it -> highlight.js -> DOMPurify -> html-react-parser (React nodes).
// Ported from the transcript PoC.

const parseHtml = window.HTMLReactParser;
const domToReact = parseHtml.domToReact;
const attributesToProps = parseHtml.attributesToProps;
const createElement = window.React.createElement;

const MARKDOWN_ALLOWED_TAGS = [
  "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5",
  "h6", "hr", "li", "ol", "p", "pre", "s", "span", "strong", "table", "tbody",
  "td", "th", "thead", "tr", "ul",
];
const MARKDOWN_ALLOWED_ATTR = ["class", "href", "rel", "start", "target"];
const MARKDOWN_FORBID_TAGS = [
  "base", "button", "embed", "form", "iframe", "img", "input", "link", "math",
  "meta", "object", "script", "select", "style", "svg", "textarea",
];
const MARKDOWN_FORBID_ATTR = ["id", "name", "src", "srcdoc", "style"];

const md = window.markdownit({
  html: false,
  linkify: true,
  breaks: false,
  highlight(str, lang) {
    const hljs = window.hljs;
    if (lang && hljs && hljs.getLanguage(lang)) {
      try {
        return (
          '<pre><code class="hljs">' +
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
          "</code></pre>"
        );
      } catch (_) {}
    }
    return '<pre><code class="hljs">' + md.utils.escapeHtml(str) + "</code></pre>";
  },
});

// Harden <a>: open in new tab with opener-safe rel, built as real React nodes.
const parseOptions = {
  replace(node) {
    if (node && node.type === "tag" && node.name === "a") {
      const props = attributesToProps(node.attribs || {});
      props.target = "_blank";
      props.rel = "noopener noreferrer nofollow";
      return createElement("a", props, domToReact(node.children || [], parseOptions));
    }
    return undefined;
  },
};

export function renderMarkdown(source) {
  const rawHtml = md.render(source || "");
  const clean = window.DOMPurify.sanitize(rawHtml, {
    ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR,
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    FORBID_ATTR: MARKDOWN_FORBID_ATTR,
    FORBID_TAGS: MARKDOWN_FORBID_TAGS,
  });
  return parseHtml(clean, parseOptions);
}
