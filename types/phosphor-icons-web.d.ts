/**
 * @phosphor-icons/web ships no types and its exports map points each weight
 * straight at a CSS file, which TypeScript's bundler resolution cannot type
 * on its own for a side-effect import. Declare the one weight we load.
 */
declare module "@phosphor-icons/web/regular";
