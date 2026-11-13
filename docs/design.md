# Design system

This is the FamilyFi design system: the design project's rules, each tied to the code that carries it out (where the code lags, see [Open differences](#open-differences)), for the web here and the native app in [familyfi-mobile](https://github.com/nickberardi/familyfi-mobile), which reads this file from its `vendor/familyfi` submodule. It is sufficient alongside tracked source for UI work in a fresh clone.

## Source and sync

The design system is the claude.ai/design project **FamilyFi Design System** (`e4b1fda4-6b5f-44f2-a103-d851f0d4051f`, <https://claude.ai/design/p/e4b1fda4-6b5f-44f2-a103-d851f0d4051f>). Its `readme.md`, `SKILL.md`, `guidelines/`, `tokens/` and component notes are the source for look, voice and component behaviour. This file is the repository's copy of those rules, with each one tied to the code that carries it out, so that agents, CI and contributors without access to the project can check a change against it.

- **Last synced:** 2026-11-01, from the project's `readme.md`, `SKILL.md`, `github.md`, `guidelines/rules-model.md`, `guidelines/card-stack-motion.md` and `tokens/`. The project keeps its own sync log in its `github.md`.
- **Keeping the two matched** is the [design-sync skill](../.agents/skills/design-sync/SKILL.md): it pulls the project into this file, and turns a design decision made in a pull request into a change for the project. A UI decision is not finished until both agree.
- **Who wins.** The project decides how FamilyFi looks and reads. This repository decides how it is built: file locations, token names, font and icon delivery, tests, and the [invariants](../AGENTS.md#invariants). Where the code and the project disagree on a look and neither has been decided, it is listed under [Open differences](#open-differences) for the operator; never settle it silently in either direction.
- **Review.** Before a pull request that changes UI, the `design-reviewer` subagent (`.claude/agents/design-reviewer.md`, `.codex/agents/design-reviewer.toml`) checks the diff against this file. See [Pull requests](../AGENTS.md#pull-requests).
- Local `designs/` exports (`Web Design.dc.html`, `Sign In.dc.html`, `_ds/`) are optional references and never committed. This file and the project take precedence over them.

## Ownership

| Concern | Authoritative location |
| --- | --- |
| Web colour, typography and spacing tokens | [globals.css](../src/app/globals.css); font loading in [layout.tsx](../src/app/layout.tsx) |
| Reusable controls and marks | [src/ui](../src/ui) and [src/components/ui](../src/components/ui); compose these before introducing a new primitive |
| Brand artwork and its composition | [public/brand](../public/brand) and [Logo.tsx](../src/components/ui/Logo.tsx) |
| Access labels, schedules and actions | [display.ts](../src/lib/display.ts), [group-actions.ts](../src/lib/group-actions.ts), [pause-sheet.ts](../src/lib/pause-sheet.ts), [rule-actions.ts](../src/lib/rule-actions.ts), [day-timeline.ts](../src/lib/day-timeline.ts), [group-schedule.ts](../src/lib/group-schedule.ts), [internet-zone.ts](../src/lib/internet-zone.ts) and [shared vectors](testing.md#display-vectors) |
| Components shared with the native app | [src/ui](../src/ui): React Native components the web renders through react-native-web; see [shared components](#shared-components) |
| Rule and resolver verdicts | [rules.ts](../src/lib/rules.ts), [upstream.ts](../src/lib/upstream.ts) and [architecture](architecture.md#upstream-dns-categories) |
| Native typography, navigation and adaptive layout | [familyfi-mobile's components and design](https://github.com/nickberardi/familyfi-mobile/blob/main/docs/architecture.md#components-and-design-srccomponents-srcdesign); read its current sources for platform details |

Shared meaning must survive platform adaptation: Pause blocks all internet for a group and names that scope, an internet rule is optional, time follows the household timezone, and unknown observations remain unknown. Native
controls, fonts and navigation can differ; web CSS dimensions are not a native layout specification.
Record deliberate web choices here and native choices there, with links rather than mirrored claims.

## Non-negotiables

- **Never restyle a verdict.** See [Colour](#colour).
- **Accent blue is interaction only**, never a verdict. Its one use as state is the internet rule: its band on the day timeline and its Internet mark. Nothing clickable takes the brand cyan.
- **Everything sits on a card.** Hairlines do a shadow's job; only sheets, toasts, dropdowns and popovers (with `--ff-shadow-toast`), switch knobs and the phone's card stack lift.
- **14px is the floor** for anything a person reads. The one exception is the 10 / 9 caption and state word under a `Mark` (the logo tagline is artwork).
- **Voice:** second person, sentence case, no exclamation, no emoji. Destructive copy states the consequence in one sentence before the button.
- **Flat backgrounds.** No gradients, imagery or illustration; the only blur is the header wash (`--ff-blur-header`).
- **Motion is near-instant.** Nothing bounces except the phone's card stack settle.

## Shared components

`src/ui` holds the components the web and the native app ([familyfi-mobile](https://github.com/nickberardi/familyfi-mobile), which vendors this repository) draw from one source: the group card's header, Internet mark, internet zone, day timeline, category marks and focused category zone, the filter sheet's content and the Add app form, the new-group form, a group's resolver card, the Devices list's rows, quarantine card and device detail, the Rules list's cards and the rule editor's form, the Categories list, resolver card, category page and new-category form, the Sync page's tiles and log, the update card and its automatic-update schedule, Settings' tabs and its gateway, key and household cards, Diagnostics' gateway load card, Pair Device's paired devices and pairing sheet, the navigation's status cards (update, sync, groups needing a device, the signed-in account), the sign-in form and its button, and the FamilyFi lockup. They use React Native primitives (`View`, `Text`, `Pressable`) and `aria-*`/`role` props, which react-native-web renders as DOM (`next.config.ts` aliases `react-native` to it and resolves `.web.tsx` first; `ReactNativeWebStyles` puts its stylesheet in the server-rendered HTML). Their logic lives in `src/lib`. Where the web needs something react-native-web cannot give it, a `.web.tsx` beside the component keeps the same exports: the lockup draws through `next/image` in `Logo.web.tsx`, from the geometry both share (`src/lib/logo.ts`). Platform controls (a text field, segmented control, switch, time and day pickers, select, link, confirmation and copying to the clipboard) come from `UIContext`: the web passes its own in `DefaultUI.web.tsx`, and the native app its platform's; a link takes the web's path, which the app maps to its own route. The companion's group card opens in place on wide screens and a group's own page (`ExpandingGroupCard.tsx`); on a phone its stacked cards, placed by `src/lib/card-stack.ts`, open to the same body (`StackedGroupBody`, `ExpandedGroupBody` with its own focus, and `GroupCardLinks`; and the Rules list card's `StackedRuleBody`, its `RuleCardSchedule`, and `RuleCardActions`) under a compact head (`RuleCardSummary`, and the group header's `mark`). Both platforms end a card with the same foot, `CardFoot` (`GroupCardLinks` and `RuleCardActions` draw theirs with it); the web draws neither the stack nor its heads.

- Colours come from `useUI().color("<token>")`, never a literal: the web's `DefaultUI.web.tsx` returns `var(--ff-<token>)`, and native clients supply the palette for their appearance through `UIProvider`. Glyphs come from `useUI().Icon` (Phosphor's `Icon` on the web), and form controls from `useUI().TextField` and `useUI().Segmented`: the web passes its own input and segmented control (`src/components/ui`), so a shared form's fields are the web's own elements, and native clients pass their platform controls.
- react-native-web resets `line-height`, so every shared `Text` sets its own (1.5× its size, the web's default; the project says 20px at 14px, an [open difference](#open-differences)). Pressed controls use `PRESS_OPACITY`, the web's `--ff-press-opacity`.
- A web-only concern (a Next `Link`, a DOM sheet) stays in the `src/components` wrapper around the shared component and reaches it through a prop or slot, such as the group schedule's `footer`.

## Interaction rules

- Present the household task and its result in plain language. Keep gateway implementation details in diagnostic views where they help an operator act.
- Reuse the shared action and display functions so cards, details and sheets agree on labels and available actions. Do not infer actions from colour or duplicate schedule calculations in a component.
- Show saved configuration separately from enforcement progress. Use the existing mutation feedback and per-action change tracking described in [key flows](architecture.md#key-flows).
- Distinguish initial loading, an empty household, a failed request and an unknown measurement. A retained result after a failed refresh is not evidence of a fresh observation.
- Preserve keyboard access, accessible names and visible focus when composing controls. Verify desktop and phone layouts, including relevant loading, empty, pending and failure states.

The sidebar keeps its height for navigation: its status cards (sync, groups needing a device) show in full while they fit, and when they would push the navigation into a scroll they collapse into one row that names the notice or counts several and opens the cards in a popover beside the rail (`src/components/SidebarStatus.tsx`). The native app shows the cards themselves.

The Devices list leads with the observed connection status and links each identity to a read-only detail page. The detail page leads with a named presence state and connection summary, then groups identity and connection fields into two cards that stack on narrow screens. Assignment remains a separate control on the list. Last-known status names the checked time; it never looks like a fresh online result.

## Type

**Inter** carries every UI size and **JetBrains Mono** the machine column — MAC addresses, IPs, policy names, endpoints, timestamps. Both are loaded by `next/font` in `src/app/layout.tsx`, which downloads them at build time and serves them from the deployment, so a household gateway never reaches Google Fonts at runtime. `--ff-font`, `--ff-font-display` and `--ff-font-mono` are the only names to use; `@theme` forwards Tailwind's `font-sans`/`font-mono` to them, so `font-mono` on an identifier is correct and a hand-written stack is not.

**Size ramp:** 26 stat · 21 page title · 17 object title on web, 19 on phone (group card, rule card, `EditorSection`) · 17 sheet and dialog title · 16 input and phone action · 15 sidebar wordmark · **14 body, the floor**. Labels, chips, segmented controls, the On/Off pill, time fields, day letters, section labels, tags, notes, table headers and the write-preview verbs are all 14px. Only the `Mark` caption (10px) and its state word (9px) are smaller.

- **Card titles have two tiers.** Panel headers on settings-style cards (Settings, Pair Device, Resolver, Updates, Diagnostics, Checkup) are 14px/600. Object and section titles (group card, rule card, `EditorSection`) are 17px/600 on web and 19px on phone.
- Weights are 400, 500, 600 and 700. Titles and monograms track at -0.01em. Body leading on 14px copy is 20px in the project; shared `Text` uses 1.5× its size (see [Open differences](#open-differences)).
- **Numbers and identifiers are mono:** MAC addresses, IPs, policy names, endpoints, timestamps, console IDs. A placeholder for a missing value ("—", "No key saved") is not mono.

## Colour

- **Never write a raw colour literal.** Every colour is a `--ff-*` token in `src/app/globals.css`; add a token rather than inlining `rgba(...)` or a hex. The exceptions are `themeColor` in `src/app/layout.tsx`, which the browser reads before CSS exists, and the shared palette `src/ui/palette.ts`, which spells each token for native clients that have no stylesheet (`tests/unit/ui-palette.test.ts` keeps its light values equal to `globals.css`).
- **Palette.** Ink `#1c1c1e` on page `#f5f5f7`, cards pure white. Accent `#0066cc` is the only interactive colour. Semantics: on `#1e7a34`, paused `#c04c00`, danger `#c8100a`, now-marker `#ff9500`, upstream `#5854d6`. Alpha ink tints (`--ff-ink-2/3/4`) carry hierarchy instead of extra greys. Transparency is for ink hierarchy and row tints, never glassy decoration.
- **The verdict palette is one system.** Five states — `rule`, `blocked`, `partial`, `open`, `unknown` — each with an ink, a fill and a line under `--ff-verdict-*`. The colour answers *who* is blocking, which is why none of them borrows the accent. Never restyle a verdict locally and never reuse those colours for something that is not a verdict. One exception, decided on purpose: a group's status badge (`StatusBadge`) is a state, not a verdict, and draws its green "Online" and red "Blocked" through its own `--ff-status-*` tokens, which share the `open` and `rule` values; a verdict never uses the `--ff-status-*` tokens. `unknown` means we could not look; it must never read as `open`.

| State | Colour | Meaning |
| --- | --- | --- |
| `rule` | red ink on light red | A FamilyFi rule is blocking it right now. Always wins the display over an upstream verdict. |
| `blocked` | white on medium purple | Fully blocked upstream by DNS |
| `partial` | purple on light purple | Partially blocked upstream by DNS |
| `open` | green on light green | Measured all-clear |
| `unknown` | grey on grey | Never checked; never the same as open |

A mark's state word renders even when blank (as a non-breaking space) so a row of marks keeps one baseline. Notice tones (info, success, warning, danger) answer *who is speaking* and never borrow verdict colours.

## Spacing, radii and widths

- **Spacing.** 18px card padding, 24px page padding on web (16px on narrow screens and on phone), 16px between cards, 14px mark gutter. Rows are 12–14px vertical. These are the product's values, not a 4/8 grid.
- **Radii.** Chips 6, controls and fields 7 (`--ff-radius-control`), buttons 9 (`--ff-radius-button`, every button including card-foot buttons), tiles 10, cards 12 and up, pills 999. Group and network marks are rounded squares at 25% of their size.
- The Card System's density ladder is 44 / 32 / 24 px marks — comfortable, compact, dense. Never a fourth size. (The 22px filter mark and the 34px category and Internet tile are marks of their own kind, not density steps.)
- **Widths** are content widths; padding is extra. Detail pages 960, editors 760, confirm dialogs 400, form dialogs 520.
- **Touch targets** are at least 44px on phone; a tight row's remove `x` has a 32px target on web.
- Prefer a shared primitive in `src/ui` or `src/components/ui` over a fourth copy of the same control. If you are writing a segmented control, a mark, a day picker or a pill, one already exists.

## Buttons

- **A button's role decides its look**, never the page it sits on. `primary` is the one main action, filled in the accent; `secondary` an alternative, accent text on a light accent wash with an accent hairline; `destructive` removes or turns something off, filled red, and always asks first; `cancel` backs out in grey text with no border; `quiet` is a tertiary action inside a row or card. Shared components take the role from `Button` (`src/ui/Button.tsx`), web components from `src/components/ui/buttons.ts`. A disabled filled button fades to `--ff-disabled-opacity-filled` (0.6), any other control to `--ff-disabled-opacity` (0.4). Button corners are `--ff-radius-button` (9px), field and select corners `--ff-radius-control` (7px).
- **Choosing the role**, by what the button does: `primary` (the one action the surface exists for), `destructive` (deletes or pulls a live policy, always names its object, "Remove device", "Delete rule", and always opens or sits inside a confirm), `secondary` (a real alternative, a write that isn't the primary such as "Keep it" on Checkup, and "Check now" (small) on every surface, Diagnostics included), `cancel` (always labelled "Cancel", never "Never mind"), `quiet` (a tertiary action inside a row or card).
- **Order:** Cancel left, primary right-most. Labels name the verb and its object, never "OK" or "Submit". While busy, both lock and the primary shows its progressive form ("Saving…").
- **In-card single actions stay filled** (Unblock, Resume, Export household, Replace key, Save timezone).
- The one exception to "Cancel is left-most": an edit dialog may carry one "Delete…" as red text on the far left of its footer. The rule editor's header "Delete rule…" is a red fill. In tight rows (the Devices list) remove is a red Phosphor `x` that always opens the confirm.
- Hover darkens the accent (`--ff-accent-hover`) or warms a row tint; press drops opacity to `--ff-press-opacity` (0.72). No scale transforms.

## Dialogs

- **One dialog frame.** Every web dialog is `Modal` (`src/components/ui/Modal.tsx`), usually through `SheetFrame`: a 400px `confirm` for a question, a 520px `form` for something to fill in. It takes focus, keeps Tab inside, closes on Escape (the topmost only) and on the scrim, and returns focus to its opener. The title is 17px semibold, the consequence under it 14px grey; the footer is right-aligned with Cancel left of the action and the main action right-most. Shared dialog content draws the same with `DialogHeader` and `DialogFooter` (`src/ui/DialogParts.tsx`), which stack full-width buttons, main action first and Cancel last, once there is more than one action. The cancel label is always "Cancel".
- **Ask with the styled confirm, never the browser's.** `useUI().confirm` on the web is `askConfirm` (`src/components/ui/ConfirmHost.tsx`), drawn by the `ConfirmHost` the root layout mounts. Pass `destructive: true` when the step removes or turns something off. Browser tests answer it with `tests/browser/confirm-dialog.ts`.

- **Sizes.** `confirm` (400) for any decision about something that already exists: delete group, delete rule, remove device, remove login, revoke, sign out everywhere, turn off resolver checking, remove the DoH override. `form` (520) for creating or editing, Create login included, up to **six controls**. A form that outgrows that is an `EditorPage`.
- **Anatomy.** Title 600 with no footer divider. A failed save shows as a danger `Alert` above the footer, never only in a toast behind the scrim.
- **Destructive confirms.** The consequence goes under the title in one sentence naming everything that is lost: deleting a group also deletes the rules only it uses; removing a login signs the person out and removes their phones, Watches and agents. Then Cancel, then a red filled button naming the object. A red-filled button always opens a confirm.
- **Choice sheets** (Pause, Block, Unblock): the 400 frame, option rows inside the padded body, Cancel alone at the right of the footer. The option with no end time ("Until I resume", "Until I unblock") is always last.
- **Three actions** (primary, a secondary such as "Block on a schedule…" or "Edit rule and schedule", and Cancel) stack full-width, primary on top and Cancel last, on web and phone.
- **Category sheet copy.** Creating: "Block <name>" / "Blocks <name> for <group> all day…". Re-enabling an off rule: "Turn on" / "Turns “<rule>” back on with its own schedule". "Turn off <name>" is a red fill and, for a rule several groups share, says it turns off for every group it covers.
- **Remove device:** "FamilyFi forgets this device. While it's connected, it comes back unassigned and stays offline until you assign it." (the second sentence only while unassigned devices are kept offline).
- **The pairing sheet's app link.** Under the pairing code, on its own line: "Open in the FamilyFi app" in the accent colour at 14px/600, with a 14px grey note under it. It has no out-arrow, because it opens the app and leaves the tab where it is. It shows only on the web, on a device the app runs on, and only until the code expires, and never for a code that carries a Cloudflare Access token; copying the code stays the fallback. Its copy is `src/lib/pairing-link.ts`.
- On the phone the same content is the app's `Sheet` (familyfi-mobile), with the same anatomy and footer rules; shared dialog content draws its header and footer with `DialogParts`.

## Notices

- **A notice that asks for attention is an `Alert`** (`src/ui/Alert.tsx`): `warning` for a condition or consequence to know about, `danger` for an error, `info` and `success` for news; `role="alert"` for an error that just happened. An explanation that asks nothing of anyone stays a plain grey note.

- An `Alert` has a tone icon, an optional 14px/600 title in the tone's ink, a 14px body in `--ff-ink-2`, and at most one accent text action. Its tint is painted over the card colour so it looks the same on the page and inside a card. One shared component for web and phone.
- It sits above what it is about and stays until the condition clears. Warning and danger take no dismiss. One alert per condition, at most two per page. A static caution about a consequence (the Lock DNS caution) is a warning too.
- A **Toast** is a receipt: bottom-centre, one at a time, about 4 seconds, may carry Undo, and is never the only copy of an error.
- **An error may carry one outbound link** under its message, when the server's error names somewhere to go next (`error.link`, such as the demo's "Set up your own"): the shared `ExternalLink` in accent 14px/600 with its out-arrow, on its own line, with a 44pt touch target in the phone app (on the web the anchor's own box is its target). It is drawn by `ErrorNote` (`src/ui`, on shared and web-only cards alike, announced as an alert), as a danger `Alert`'s one action (an `href` action, which is a link, not a button), and under the toast's message, never in its action slot.
- The **status cards** in the rail and on More (`src/ui/StatusCards.tsx`: sync status, devices to assign, the signed-in account; update available) are not `Alert`s.

## Forms

- **Fields** use `.ff-input` (in `globals.css`): 16px text, the input line, and an accent border with a 3px focus ring. Labels over a field are 14px semibold in `ink-3`.

- `Field`, `TextField`, `TimeField` and `TogglePill` are in `src/components/ui/Controls.tsx`; shared forms get their fields through `useUI()`. `Field` stacks the label over its control in every sheet. Never `outline: none` without a replacement focus style.
- **Segmented** (`src/components/ui/Segmented.tsx`; Always | Scheduled, Person | Network) is a white chip on the field trough, 14px at every size.
- **DayPicker** (`src/components/ui/DayPicker.tsx`) is seven 32px day toggles with 14px letters, accent fill when selected; it wraps on very narrow screens (about 320px).
- **TimeField** ("Offline", "Back on") has its 14px label inline to the left and a 14px value.
- **Every switch is the On/Off pill** (14px). A control that turns something on or off is a real switch, never a button labelled with its state. Quarantine's pill reads Enforced / Off.
- Disabled is 0.4, or 0.6 on filled buttons, and nothing else.

## Pages and navigation

- **PageHeader** (`src/components/PageHeader.tsx`): sticky 21px title, a subtitle that is one plain line with no full stop, and at most one accent action. Every detail page has one that names the item (device and category pages included). An editor's Save is that one action; there is no pinned footer.
- **Back links** (`src/components/ui/BackLink.tsx`) sit above the title in one style: "← Label", 14px semibold accent. A rule opened from a group reads "← Rules for <name>". ‹ is retired.
- **Loading** shows the page header, never a blank page. A real not-found is the header and back link, then an `EmptyCard` saying so. A failed load is a danger `Alert` with "Try again", never "not found".
- **EmptyCard** (`src/ui/EmptyCard.tsx`; not found is `src/components/ui/NotFound.tsx`) is the one-line "Nothing here yet." in a card's place.
- **Web navigation**: the rail on the left with three groups (Household, Network, System); its section headings are the only uppercase labels in FamilyFi. On narrow screens the rail becomes a drawer behind a top bar, page padding drops to 16px and auto-fit grids collapse to one column (the breakpoint is an [open difference](#open-differences)).
- **Phone navigation**: the tab bar holds only the three daily destinations (Family, Things, Devices) plus **More**. Never add a fifth tab; a new page is one entry in More, pushed full-screen with a back button.

## Cards

- **Card** (`Card` in `src/components/ui/Controls.tsx`) is the white ground with a hairline border (`--ff-hairline-card`). Padding goes through `className`: card padding for content, none for flush row lists.
- **CardFoot** (`src/ui/CardFoot.tsx`) is the one foot for the group card and the rule card: the state line on its own row, then a row of outlined buttons (white, hairline-card border, radius 9, 14px semibold, ink text). The strong action (Resume, Unblock) stays a filled primary. Edit sits left on its own; the other actions sit right, the primary right-most. At large text (font scale 1.35 and up, `STACK_AT` in `src/ui/use-large-text.ts`, the one threshold for every shared stacking) the buttons stack. "More time" is a button here, and a text link only when it hangs off a header state line. `ActionRow` is retired.
- **GroupCard** (`src/components/GroupCard.tsx`, with `src/ui/GroupCard*.tsx` and `ExpandingGroupCard.tsx`) opens and closes. Closed: identity, caret, Internet mark, divider, one fitted line of categories. Open: the group's one button (Block, Unblock or Resume) in the corner (at large text, `STACK_AT`, the button and More time sit under the header instead, lined up with the name, so they never cover the name or badge, and the caret stays as the close control), today's schedule, categories, app rules, then a `CardFoot` with "Details" left and "Show less" / "Show more" right. The name carries a round **status badge** (`src/ui/StatusBadge.tsx`), green "Online" or red "Blocked" (`groupStatusParts` and `groupBadge` in `src/lib/group-actions.ts`, `--ff-status-*`), and no role or "device group" word; the group's Edit sheet sets the role. Under the name, the line saying why is grey while the rules do what they always do ("Video blocked until 6:00 PM", "Quiet time until 2:00 PM"), red when someone blocked the group, and green when someone lifted a block (an unblock, or its internet rule paused). An always-on category, app or website rule (No TikTok) is how the group is set up, not a block on it: it never changes the badge, the line or the button. The button is Unblock whenever anything blocks the group now (its own block, an internet rule, or a scheduled category, app or website rule, so Unblock can sit beside Online while Video is on its schedule), Resume after an unblock, and otherwise Block. While a category, app or website rule blocks the group now or is lifted for it alone, the button is a **split button** under every label: the caret beside it (`CardMenuButton` in `src/ui/CardActions.tsx`, labelled "More choices for <group>") opens a dropdown (`groupHeaderActions` in `src/lib/group-actions.ts`) with "Block internet" while the group has the internet and the button is not Block; "Unblock <rule>" for each rule blocking it now (its internet window first, then scheduled rules, then always-on ones, leaving out the one rule the button already lifts on its own), each opening that rule's sheet for the group worded as an unblock ("Unblock Video for Sam?", the group's page keeps "Pause Video for Sam?"); and "Block <rule> again" for each rule paused for the group, which puts it back at once with a "Video blocked again for Sam." notice. The group's page shows the split only to offer Block internet (its dropdown holds nothing else): the page lists every rule with its own Pause or Resume, so single-rule choices stay on those rows in the page's words. The dropdown is the one place a choice opposite to the button sits (Block internet beside Unblock), out of sight until asked for. The Apple Watch and Wear OS draw the same choices as plain buttons under the group's button (familyfi-mobile follows each change). The dropdown is a disclosure, not an ARIA menu: the caret (44 wide to touch on a phone) toggles a list of plain buttons in tab order, Escape or a click elsewhere closes it, and focus returns to the caret, so the sheet a choice opens hands focus back there. On a phone it opens over the whole screen (`src/lib/card-menu.ts` places it), so a tap anywhere outside it closes it and does nothing else, as does Back on Android; there it opens above the button instead when there is more room above than below, and stays clear of the system bars (44pt from the top and bottom at least, 8pt beyond a taller Dynamic Island or navigation bar), scrolling if it is taller than that leaves room for; a long label wraps rather than running off the screen's far side. It hangs under the button, aligned to its outer edge (the left when large text puts the button under the header), on the card ground with a hairline-card border, radius 10, minimum width 240, rows 14px ink (16 on a phone, each row at least 44pt tall) with 14/10 padding and hairline dividers, a `field-soft` hover tint, and `--ff-shadow-toast`; on the web the card it belongs to rises over the cards below while it is open. The group page's card leads with the same badge and line. A state badge is round and tinted; the grey square `Tag` only names a kind of thing ("Built-in"). Monograms and account initials grow at most 1.2× with large text, so they stay inside their tile.
- **Card marks** (`src/ui/InternetMark.tsx`, `src/ui/CategoryMarks.tsx`, `src/ui/GroupCardMarks.tsx`). The Internet mark is a 34px rounded tile with a state word (its words are an [open difference](#open-differences)); "No rule" only when the group has none. The More and "Block an app" marks are dashed.
- **SectionLabel** (`SectionLabel` in `src/ui/CategoryMarks.tsx` for shared components, and a web copy in `src/components/FilterMarks.tsx`) is 14px, 600, `--ff-ink-2`, sentence case: group card sections, table headers, Sync stat tiles, release notes, Running / Newest, Checkup heads, "How to fix".
- **Tag** (`src/ui/Tag.tsx`) is a grey square, sentence case, 14px: "Built-in", "Experimental". "Private" on a device is not a Tag; it stays the orange warning icon and word.
- **Day timeline** (the project's `ScheduleBar`; `src/ui/DayTimeline.tsx`, inside `src/ui/GroupSchedule.tsx`) is the 24-hour strip: every rule on one bar (internet in accent, others in `--ff-schedule-1…5-fill` and `-line`), the orange hairline is now, 14px hour labels (12 AM, 6 AM, Noon, 6 PM). When large text leaves too little room, the labels drop to 12 AM, Noon, 12 AM, then to the two ends (`timelineHours` in `src/lib/day-timeline.ts`), never wrapping or overlapping.
- **RuleCard** (`src/ui/RuleCard.tsx`, listed by `src/components/rules/RulesList.tsx`) is one card for every rule, standard or built-in. Built-in rules (Quarantine, Lock DNS, Countries, later SafeSearch) differ only by the "Built-in" tag and list first, in that fixed order; then the household's rules in the order they were made, which is also the order that colours a group's schedule. Its foot reads Edit, then More time, then Resume. A single-app mark shows the app's name, falling back to the rule's name (never "App"); a rule blocking several apps shows the rule's own name. Monograms are word initials for two or more words ("Kid apps" → KA), otherwise the first two letters (TikTok → TI). Captions cap at two lines with an ellipsis.
- **A new built-in rule** defines its id and Phosphor glyph, its "Blocks" summary, its Applies to wording, its switch words if On/Off would mislead, what a pause lifts, its own page, and its Checkup entry. Built-ins are never deleted or renamed and never appear on a group's schedule.
- **Built-in rule pages.** Lock DNS has the same Status section with an On/Off switch as Block countries; the switch edits the draft and saves with Save. Subtitles read "On · <what it blocks>" / "Off · <what it blocks>". Every editor, Block countries included, has a write preview.
- **Editor pages** (the project's `EditorPage`: the `EDITOR_PAGE` layout in `src/components/ui/BackLink.tsx`, sections from `src/ui/EditorSection.tsx`, as in `src/components/rules/RuleEditor.tsx`) are the long-form destination: 760 wide, Save in the page header, the write preview always visible, and leaving with unsaved changes asks with a confirm. `EditorSection`'s note is 14px `--ff-ink-2`; its title takes the platform's object-title size. On the phone it is a pushed full-screen page, not a taller sheet. At large text the rule editor's gateway policy names put their character count under the name instead of beside it.
- **Write preview.** NEW / CHANGE / DELETE / KEEP stay uppercase mono at 14px, each a tinted fill with coloured text (KEEP on the field fill in `--ff-ink-2`), in a fixed-width column. They are not Tags. Rows sit directly in the editor card.
- **Card stack** (phone Family, Things and Rules): closed cards tuck 8px under the one in front; tapping a head opens it, cards above fold to peeks and cards below follow. Close by tapping the head, dragging down (commit past 90px, or 12px faster than 800px/s), Back or Escape. Layout comes from `src/lib/card-stack.ts`; the native motion lives in familyfi-mobile. Spec: the project's `guidelines/card-stack-motion.md`.

## Copy

The product writes like a careful sysadmin explaining something to their spouse: plain, second person, no exclamation, no emoji. Match the voice already in `src/lib/*-copy.ts` and the shared display functions rather than inventing copy.

- **You, not we.** The app describes what it did to your network, not what it feels.
- **Sentence case everywhere.** The rail's section headings are the only uppercase labels (and the write-preview verbs, which are not labels).
- **Plain household pages.** Family, Things, Rules, Devices, Categories, Checkup, the rule editor and its write preview, and every sheet use plain words and keep "gateway". "UniFi policy", "reconcile", "desired state" and "DPI" appear only on Sync and Diagnostics. The sync button is "Sync now" / "Syncing…".
- **Rule, not schedule.** "Rule" is the noun for what a household makes; "schedule" is only the time view: "+ Add a rule", "Pause or change rules →", "Edit rule and schedule". Header buttons say "New X" and match their sheet's title. Apps are blocked with "Block an app".
- **Lists** read "A, B and C", with no "only": "YouTube, Roblox and TikTok · everything else stays on".
- **Status lines** (the design project still writes "Online · …" on one line; see Group status under [Open differences](#open-differences)). On a group card the badge says Online or Blocked and the line under it starts as a sentence. "No internet rule" only when the group really has none (its device line is then just the count, "4 devices"); "Internet rule off"; "Internet rule paused for everyone until <time>".
- **State is named, not decorated.** "Paused until 6:00 PM", "Blocked upstream", "Unknown — quarantined". Never "Oops!" or "All good 🎉".
- **This device, not this phone.** The app calls what it runs on "this device": the same app runs on a phone, a tablet and a Mac. The exception is what only a phone can do, such as setting up a Watch (`src/lib/watch.ts`).
- **Consequences up front.** Destructive copy says what will actually happen, in one sentence, before the button.

## Brand

The mark is **artwork, not geometry**. `src/components/ui/Logo.tsx` composes `public/brand/shield-family.png` (the shield with the family inside), `shield-check-light.png` / `-deep.png` (the small check shield that dots the **i** of Fi, cut once per ground so it never traps the wrong colour) and `app-icon.png` (the shield on its navy tile, also the favicon and the web manifest icon). Only the wordmark is live text, so it can invert. **Never redraw or approximate the shield** — place the file.

The brand ground is a separate palette from the product UI: deep navy `--ff-brand-deep`, azure `--ff-brand-cyan`, declared under the brand-layer comment at the foot of `:root` in `globals.css`. It belongs to the mark, the app icon, the splash and marketing. The accent blue stays the only interactive colour; nothing clickable may take the brand cyan.

- **Where the logo goes.** Web: the stacked lockup heads the rail, sign-in and every setup step (centred, the welcome line under it). Phone: the inline lockup without tagline rides above the title on root tabs only; pushed pages drop it. The stacked signature appears once, at the foot of More. On the brand navy ground the wordmark inverts and the dot shield swaps to its navy cut.

## Iconography

FamilyFi's own iconography is typographic — monograms inside `Mark`, chevrons — and that covers everything the product invented. Everything the world already named (a phone, a printer, a gear, and the categories: a play button for Video, a group of people for Social, `CURATED_SLOT_ICONS` in `src/lib/rules.ts`) comes from **Phosphor Regular**, imported once in `src/app/layout.tsx` from the `@phosphor-icons/web` package rather than a CDN.

`src/components/ui/Icon.tsx` is the only place that may write a `ph ph-…` class, and `IconName` in `src/lib/icons.ts` is the closed set of glyphs it accepts. A name Phosphor does not have renders as *nothing at all*, which is why the union is checked against the shipped stylesheet in `tests/unit/icons.test.ts`. Do not mix in a second icon pack, and do not hand-draw a replacement for a glyph Phosphor has. Named apps keep short monograms rather than real logos — a licensing decision, not a style one. Emoji are never used.

- Typed glyphs stay: ☰ × + – and the back link's ←. Phosphor covers device types, categories and the red remove `x` in tight rows. "Fewer" uses an en dash on purpose.

## Motion

0ms for state flips, 120ms for hovers (`--ff-duration-fast`), 180ms for sheets (a project value with no token here yet), easing `--ff-ease-standard` (`cubic-bezier(.32,.72,0,1)`). Nothing slides in decoratively; the gateway is the slow part, never the interface. The phone's card stack is the one element that overshoots (520ms settle, 200ms with Reduce Motion; these springs live in familyfi-mobile's `src/design/motion.ts`). Respect `prefers-reduced-motion`.

## Phone and watch

The native app keeps the shared meaning above and adapts the presentation to each platform; its own choices are recorded in [familyfi-mobile's components and design](https://github.com/nickberardi/familyfi-mobile/blob/main/docs/architecture.md#components-and-design-srccomponents-srcdesign) and checked by its own `design-reviewer`. The design system fixes these for phones:

- Same cards and verdict colours; 16px page padding; object titles 19px.
- The tab bar holds Family, Things, Devices and More, never a fifth tab.
- Dialogs are the app's own `Sheet` (in familyfi-mobile) with the same content and copy as the web's `Modal`.
- The card stack replaces the card grid on phones.
- A one-tap Block switch (Control Center, Quick Settings, a widget) is another surface for group status: it is on exactly when the group's card badge reads Blocked, its state line is the badge's word, it offers no timed choices, and unblocking waits for the device to be unlocked. On iPhone a control has only one action, so from the lock screen blocking asks for the unlock too. Its glyph is the block sign in both states (SF Symbols `nosign`, the same sign on an Android tile), never the shield and never a Wi-Fi glyph, which Control Center already uses for the network switch; its state shows in the platform's own on colour (system red on iPhone, the system accent on Android) and its state word. Its copy is `src/lib/block-switch.ts`.
- An app's Siri, Shortcuts and system controls are their own row in Paired devices, named for the platform ("Siri and Shortcuts on …", "Quick Settings and shortcuts on …") with "Set up automatically by …" as its origin. The row has Revoke and never Re-pair, because the app sets it up again when it is next opened; revoking the app names it among what stops working.
- On iPhone, iPad and Mac, a timed block made on a device gets one local notification five minutes before it ends: "Block for <name> ends in 5 minutes" / "Internet comes back then. Choose More time to keep it blocked.", with one action, More time, which opens the same sheet as the card's. It is scheduled by the device that made the block, never sent by the server, and is dropped when the block ends early. Its copy and lead time are `src/lib/pause-ending.ts`. Android sends none: its ongoing notification counts the block down in view the whole time.
- Siri and Shortcuts (iPhone, iPad), Home screen shortcuts and Quick Settings (Android) are More entries under System, never a tab. Their screens use the shared `SectionLabel`, `Button` and `Alert`: sentence-case section labels, one primary button, and a warning `Alert` when the person must act (update the server, a launcher that cannot add shortcuts). From Siri and Shortcuts, blocking and reading run from the lock screen; unblocking and adding time wait for the device to be unlocked. Example phrases are quoted with curly quotes and name one of the household's own groups. A group's Home screen shortcut on Android is labelled "Block <name>" wherever a launcher draws it, with a block glyph in the accent colour, never the shield: the launcher badges it with the app's own icon. On Siri and Shortcuts, the way into Shortcuts is Apple's own Shortcuts button (`ShortcutsLink`), not the shared `Button`: it opens FamilyFi's page in the Shortcuts app with a tile for each group, which a plain link cannot reach. On that page each action leads with a tile titled with its action ("Block internet", "Unblock", "Pause internet", "Add more time", "Get status"), which asks which group, then one tile per group by name; Block internet's glyph is the block sign (`nosign`), never Wi-Fi, as on the Block switch. Quick Settings lists one row per tile, each with its own quiet Add button and no primary, since a row's actions are equal and up to three rows share the screen; when Android cannot offer a tile, the steps to add it are a warning `Alert`. Their copy is `src/lib/app-controls.ts` (Quick Settings: `QUICK_SETTINGS_COPY` in `src/lib/block-switch.ts`); Siri's spoken answers are written in the app's Swift, with statuses and times from the shared display port; Unblock's answer is shared (`unblockAnswer` in `src/lib/block-switch.ts`), because Unblock leaves an always-on category, app or website rule on: with nothing else blocking, Siri sends nothing and says the group isn't blocked and which rules stay on, by their own names as the card's dropdown names them ("TV isn't blocked, so there's nothing to unblock. Its “No streaming” rule is always on, so it stays on. You can change that in FamilyFi."). Siri then offers to lift one of them for the group a while ("Should I unblock it for a while?" with Unblock and Cancel, or "Which one…" listing the rule names, then "For how long?"), pausing that rule for the group alone as the card's "Unblock No streaming" does and answering "“No streaming” is unblocked for TV until 3:15 PM."; after an unblock it names the rules still on, so a parent never hears "unblocked" while a rule stays on.

## Enforcement

- Accessibility: contrast at least 4.5:1; nothing a person reads is under 14px except the exceptions under [Type](#type), and no text under 14px is drawn below 0.7 alpha. `tests/unit/mark-contrast.test.ts` checks colour tokens and `tests/browser/accessibility.spec.ts` runs axe (WCAG 2.1 A and AA) on every page in both viewports, with no exceptions.

`tests/unit/naming.test.ts` fails the build on a raw colour literal, an abbreviated product prefix, a misnamed file, an unprefixed env var of ours, a `var(--ff-…)` reference with no declaration, and a Phosphor class written outside `Icon`. `tests/unit/icons.test.ts` fails it on a glyph name the installed icon font does not have, and `tests/unit/mark-contrast.test.ts` on a verdict, accent, status or text colour under 4.5:1. These rules were written down once before and drifted anyway — the tokens existed while 71 literals sat in components — so treat the tests as the contract and this section as their explanation. Extend both together.

The `design-reviewer` subagent covers what the tests cannot: role, size, copy and layout choices in a diff, checked against this file.

## Open differences

Places where the code and the design project disagree and the operator has not yet decided. The table is a record of known drift, not a complete inventory: a review judges only the code a change adds or alters, by the project's rule, and never reports untouched code. The reviewer reports a change that widens one; the design-sync skill lists new ones here.

| Topic | Design project | Code today |
| --- | --- | --- |
| Narrow breakpoint | Rail becomes a drawer under 900px (`SKILL.md`, `tokens/spacing.css`) | Under 768px (`globals.css`, `AppShell.tsx`) |
| Rail width | 220px in `SKILL.md`, 232px in `tokens/spacing.css` | 232px (`.ff-shell` in `globals.css`) |
| Card stack on web | Web uses the stack under 768px | The web draws neither the stack nor its heads (see [Shared components](#shared-components)) |
| Logo in the narrow top bar | `SKILL.md`: inline lockup in the top bar; `readme.md`: stacked lockup heads the drawer | Stacked lockup in the drawer |
| Width tokens | `--ff-width-detail` (960), `--ff-width-editor` (760) | Literal `max-w-[1008px]` and `max-w-[808px]` (padding included); no tokens |
| Text under 14px | Only the `Mark` caption (10) and state word (9) | Also monograms (9px in `src/ui/CategoryMarks.tsx`, 10/12px in `src/ui/MonoTile.tsx`, 12px for three letters in `src/ui/GroupCardHeader.tsx`), the 10px badge in the More mark (`CategoryMarks.tsx`) and a 10px check glyph in the Admin chip's checkbox (`src/ui/AdminControl.web.tsx`) |
| Shared section label | One `SectionLabel` | Two copies, `src/ui/CategoryMarks.tsx` and `src/components/FilterMarks.tsx` |
| Internet mark words | On, Blocked, Off (the internet rule is switched off), No rule | "Blocked" while the group is paused and "Off" while an internet window is on now (`src/lib/internet-zone.ts`) |
| Group status | One coloured line, "● Online · internet rule paused for everyone until <time>", with the role beside the name | The operator chose a round Online/Blocked badge beside the name, no role, and a line under it that is grey unless someone blocked (red) or unblocked (green) the group; its wording drops "Online ·" ("Internet rule paused until <time>" for one group) (`src/lib/group-actions.ts`, `src/ui/StatusBadge.tsx`). The design project needs the badge, the line colours and the new wording; the Apple Watch and Wear OS draw the same badge and line; only the iPhone Live Activity keeps the `groupStatus` label |
| Technical words on household pages | "UniFi policy", "reconcile", "desired state", "DPI" only on Sync and Diagnostics | A custom category's note says "no UniFi policy" (`src/lib/upstream.ts`) |
| Rule, not schedule | "+ Add a rule", "Pause or change rules →" | "+ Add a schedule", "Pause or change schedules →" (`src/ui/GroupSchedule.tsx`) |
| Toast | Bottom-centre, about 4 seconds, never the only copy of an error | Top-centre (`AppShell.tsx`), 6 seconds (`NOTICE_MS`), and it shows the store's error itself (`src/ui/Toast.tsx`) with a Dismiss button, and that error's link when it has one |
| Editors | Leaving with unsaved changes asks first | Editors show "Unsaved" but don't ask on leaving |
| Back link position | Above the title | Below the page header (`BackLink.tsx`, `RuleEditor.tsx`, `LockDnsPage.tsx`) |
| Write preview colours | KEEP in `--ff-ink-2` | KEEP in `ink-3` and CHANGE in the accent (`src/ui/RuleEditorForm.tsx`) |
| `quiet` button on web | One of five roles on both platforms | Only `src/ui/Button.tsx` has it; `src/components/ui/buttons.ts` does not |
| Day timeline hours | 12 AM, 6 AM, Noon, 6 PM | "NOON" in uppercase (`src/lib/day-timeline.ts`, `RULE_BAR_TICKS` in `src/lib/rule-list.ts`) |
| 14px line height | 20px | Shared components use both 20 and 21 (1.5×) |

Deliberate differences, not open: token names are the repository's (the project's `--ff-radius-lg` and `--ff-radius-md` are `--ff-radius-button` and `--ff-radius-control` here); fonts are self-hosted through `next/font` and Phosphor comes from the `@phosphor-icons/web` package, so a household gateway never reaches a third party at runtime, where the project loads both from CDNs. The project's note that the product "ships no icon set" predates Phosphor in the repo.
