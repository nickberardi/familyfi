/**
 * The web's button roles, as class lists for a `<button>` or a link drawn as one. The role
 * decides the skin, so a confirm pair looks the same in every dialog, card and page:
 *
 * - `PRIMARY_BUTTON`: the one main action, filled in the accent.
 * - `SECONDARY_BUTTON`: an alternative, accent text on a light accent wash.
 * - `DESTRUCTIVE_BUTTON`: removes or turns off something, filled red. It always asks first.
 * - `CANCEL_BUTTON`: backs out without changing anything, grey text with no border. Left-most.
 *
 * The shared `src/ui/Button.tsx` draws the same roles for components shared with the phone.
 */
const BASE = "inline-flex items-center justify-center gap-1.5 rounded-[var(--ff-radius-button)] px-3.5 py-2 text-[14px] leading-[21px] font-semibold";

export const PRIMARY_BUTTON = `${BASE} bg-[var(--ff-accent)] text-[var(--ff-ink-on-fill)] disabled:opacity-[var(--ff-disabled-opacity-filled)]`;
export const SECONDARY_BUTTON = `${BASE} border border-[var(--ff-accent-line)] bg-[var(--ff-accent-fill)] text-[var(--ff-accent-hover)] disabled:opacity-[var(--ff-disabled-opacity)]`;
export const DESTRUCTIVE_BUTTON = `${BASE} bg-[var(--ff-danger)] text-[var(--ff-ink-on-fill)] disabled:opacity-[var(--ff-disabled-opacity-filled)]`;
export const CANCEL_BUTTON = `${BASE} text-[var(--ff-ink-2)] disabled:opacity-[var(--ff-disabled-opacity)]`;

/** A dialog's or form's text field: 16px, the control radius, and a visible focus ring. */
export const FIELD = "ff-input mt-1";
