/**
 * GLTFLoader sanitises node names: whitespace becomes "_" (e.g. "بدنه بغل" → "بدنه_بغل").
 * Always compare names through this helper so data written with normal spaces matches.
 */
export const normalizeNodeName = (name) => (name ?? '').replace(/\s/g, '_');
