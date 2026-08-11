// The MathJax half of the renderer, in a chunk of its own.
//
// mathjax-full dwarfs the markdown parser it sits next to: rehype-mathjax pulls
// in every TeX package no matter what it is configured with, so this is by far
// the heaviest thing the frontend can load. A transcript without a formula in it
// must not pay for that, which is why `lib/markdown-renderer` reaches this
// module only once some text turns out to have math in it.

import rehypeMathjaxChtml from "rehype-mathjax/chtml";
import remarkMath from "remark-math";

/** Single dollars are on, which is what the `math-source` normalizer emits. */
export const remarkMathPlugin = [
  remarkMath,
  { singleDollarTextMath: true },
] as const;

/**
 * CHTML rather than SVG: the glyphs stay real text in real fonts, so a formula
 * inherits the transcript's colour and can be selected and copied. `fontURL` is
 * where the build put those fonts, and the plugin refuses to run without it.
 *
 * `adaptiveCSS` is left on, so each formula ships only the rules its own glyphs
 * need — some ten kilobytes, against the quarter of a megabyte the complete
 * table comes to. The renderer hands those sheets to React under a digest of
 * their contents, which collapses the copies a transcript would otherwise
 * accumulate down to one of each.
 */
export const rehypeMathjaxPlugin = [
  rehypeMathjaxChtml,
  { chtml: { fontURL: __MATHJAX_FONT_URL__ } },
] as const;
