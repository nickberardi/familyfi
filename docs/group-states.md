# Group states

What a group card says and offers: the status badge, the line under the group's name, the main
button and its dropdown, and what each tap does. Every client follows these rules, and each one
is pinned by a test case in `tests/fixtures/display-vectors.json`: the web, the app, the Apple
Watch (Swift) and Wear OS (Kotlin) all replay the same cases. The code is
`src/lib/group-actions.ts` (`groupStatusParts`, `groupHeaderActions`, `rulesToUnblock`); the
server side of the taps is in `src/server/group-unblock.ts`, `src/server/group-internet.ts` and
`src/server/group-rule-block.ts`.

Change a rule here, in `group-actions.ts` and in the display vectors together, then port it to
familyfi-mobile's watches.

## Words

| Word | Meaning |
| --- | --- |
| **Internet rule** | Blocks all internet for its groups, in windows or always. |
| **Category, app or website rule** | Blocks only those things (Video, TikTok, a website) for its groups, in windows or always. |
| **Scheduled rule** | A rule with windows. It blocks only while a window is on. |
| **All-day rule** | A category, app or website rule set to always. It is how the group is set up (a TV that never gets Social), not a block a parent turns on and off. |
| **Pause** | The group's own block of all internet, until a time or until unblocked. The Block button's default action. |
| **Block button default** | Optional, per group (`Group.blockButtonRuleId`): one of the group's own category, app or website rules that the Block and Unblock button acts on, such as Video for a TV. All internet when not set. |
| **Rule block** | The group's own block of its Block button default, until a time or until unblocked (`Group.ruleBlock`). |
| **Lift** | One rule unblocked for one group only, until a time. The rule itself and every other group are untouched. |
| **Group unblock** | Unblock on the card: lifts everything that counts as blocking the group now (below), for that group only. |

## Rule 1: what counts as blocking the group

The button only looks at what **counts as blocking** right now:

- the group's pause;
- the group's rule block;
- an internet rule in its window, or always on;
- a scheduled category, app or website rule in its window;
- **the Block button default, even when it is all-day.**

These never count:

- all-day category, app or website rules, other than the Block button default;
- a rule that is switched off, paused for everyone, or already lifted for this group;
- the built-in protection rules (Block countries, Lock DNS).

All-day rules are left out on purpose: they would make every such group show Unblock all day,
and Unblock would never lift them anyway. That is exactly why the Block button default exists:
picking an all-day rule (Video on a TV) makes it count, so the button can unblock it with a timer
instead of a parent switching the rule off.

## Rule 2: the badge

The badge says only whether the group has the internet.

| Badge | When |
| --- | --- |
| **Blocked** (red) | The group is paused, or an internet rule blocks it now. |
| **Online** (green) | Anything else, including while a category rule or the Block button default blocks. |

The Block switch outside the app (Control Center, Quick Settings) is on exactly when the badge
reads Blocked.

## Rule 3: the button

The button's label is always one of **Block**, **Unblock** or **Resume**. It never names a rule.
The first row that matches wins:

| # | Situation | Button | What a tap does |
| --- | --- | --- | --- |
| 1 | The group is paused | **Unblock** (+ More time if timed) | Ends the pause, and lifts anything else that counts as blocking. |
| 2 | A Block button default is set, and nothing **but** that rule counts as blocking: | | |
| 2a | the group's rule block is on | **Unblock** (+ More time if timed) | Ends the rule block at once. |
| 2b | the rule blocks now (all-day, or in its window) | **Unblock** | Opens "Unblock Video for TV?" with the usual timers, and lifts the rule for this group only. |
| 2c | the rule is lifted for the group | **Block** (+ More time if timed) | Puts the rule back at once. |
| 2d | a group unblock is still running | **Resume** (+ More time if timed) | Ends the group unblock. |
| 2e | nothing blocks (outside the rule's windows) | **Block** | Opens "Block Video for TV?": blocks the rule now, whatever its schedule says. |
| 3 | Anything else counts as blocking | **Unblock** | The group unblock: lifts every rule that counts, the default included. All-day rules that are not the default stay on. |
| 4 | A group unblock is running | **Resume** (+ More time if timed) | Ends the group unblock. |
| 5 | Nothing counts as blocking | **Block** | Opens the Block sheet: pauses all internet. |

Row 2 applies only while the default is the only thing that counts as blocking. As soon as a
scheduled rule's window or an internet rule also blocks, row 3 takes over and Unblock lifts all of
them together. One tap always clears everything that counts.

## Rule 4: the dropdown

A caret beside the button opens a dropdown when the group has other choices. It holds, in order:

1. **Block internet**, while the group still has the internet and the button is not already plain
   Block for all internet. With a Block button default, this is how a parent still blocks all internet.
2. **Unblock <rule>** for each other rule blocking the group now (internet windows first, then
   scheduled rules, then all-day ones), each lifting just that rule for the group.
3. **Block <rule> again** for each rule lifted for the group, putting it back at once.

The rule the button already handles is left out of the dropdown.

## Rule 5: the line under the name

The first that applies:

1. Paused: "Blocked until 6:00 PM by Sam", red.
2. An internet rule blocks: its window, "Dinner until 8:00 PM", grey.
3. The rule block: "Video blocked until 1:00 PM by Sam", red.
4. Other rules block: "Gaming blocked until 12:00 PM", or "Video and Gaming blocked" when one of them never ends, grey.
5. The default is lifted for the group: "Video unblocked until 12:00 PM by Sam", green.
6. A group unblock: "Unblocked until 8:00 PM by Sam", green.
7. Otherwise the internet schedule: the next window, or, with a default and no internet rule, when
   the default blocks next ("Video at 7:00 PM", or "Video not blocked").

Red means someone blocked the group, green means someone lifted a block, and grey means the rules
are doing what they always do.

## Outside the card

| Place | Block | Unblock |
| --- | --- | --- |
| Card, iPad and Mac menu bar | Rule 3 | Rule 3 |
| Block switch (Control Center, Quick Settings) | Pauses all internet | The group unblock |
| Siri | Pauses all internet | The group unblock, which also lifts the Block button default |
| Apple Watch, Wear OS | Rule 3 | Rule 3 |

The switch and Siri's Block stay on all internet whatever the default, so they agree with the badge.

## Worked example: a TV

TV has two all-day rules, Video and Social, and a scheduled Gaming rule from 10:00 AM to 12:00 PM.

| Setup and time | Badge | Line | Button |
| --- | --- | --- | --- |
| No default, 9:00 AM | Online | No internet rule | **Block** (all internet). Video and Social do not count. |
| No default, 11:00 AM | Online | Gaming blocked until 12:00 PM | **Unblock**: lifts Gaming. Video and Social stay. |
| Default Video, 9:00 AM | Online | Video blocked | **Unblock**: "Unblock Video for TV?" (row 2b) |
| Default Video, 9:00 AM, after unblocking for an hour | Online | Video unblocked until 10:00 AM | **Block** + More time (row 2c) |
| Default Video, 11:00 AM | Online | Video and Gaming blocked | **Unblock**: lifts Video and Gaming together (row 3). Social stays. |
| Default Video, Video unblocked, 11:00 AM | Online | Gaming blocked until 12:00 PM | **Unblock**: lifts Gaming (row 3). |

Whenever the button is not plain Block for all internet, **Block internet** is in the dropdown.
