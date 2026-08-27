/**
 * Shared KaTeX acceptance policy for all frontend renderers.
 *
 * Callers still own displayMode and throwOnError because direct renderers and
 * rehype-katex expose different error/fallback contracts.
 */
export const KATEX_STRICT = false as const
