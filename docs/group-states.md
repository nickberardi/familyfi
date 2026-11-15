# Group states

This file is the grounding for the group card: what it shows and what each tap does. Read it
before changing a group's badge, status line, Block/Unblock button, More time link or dropdown, on
any client. It starts with the user stories, because each rule exists to serve one of them. Then
come the rules the code follows, and then examples that are pinned as tests.

If the code and this file disagree, one of them is a bug. Fix it, or change both in the same commit.

## Who uses the card, and for what

The user is a parent who is an administrator, glancing at a phone or the web. They have a few seconds
and do not think in terms of rules, windows or policies. The card's button has to do the obvious
thing.

1. **"Is my kid online?"** The badge answers this one question: does the group have the internet
   right now? It shows **Blocked** or **Online** and says nothing about categories.
2. **"Cut it off now."** When nothing is blocking, the button reads **Block**. It blocks all internet
   for the group, either for a while or until the parent unblocks it.
3. **"Let them on now."** When something the parent thinks of as a block is on, the button reads
   **Unblock**. One tap (and a sheet to choose how long) lifts all of it for this group alone. The
   parent never has to find which rule is responsible, and the rules themselves stay unchanged for
   every other group.
4. **"Go back to normal."** After an unblock, the button reads **Resume**, which puts the rules back
   at once. **More time** extends whatever is running.
5. **"The TV never gets video, but tonight it can."** Some groups have rules that are on all day
   (Video and Social on a TV). These describe how the group is set up; they are not something a
   parent turns on and off. So by default the card ignores them: the badge stays Online, and Unblock
   leaves them alone. Without this, every TV would read "Unblock" all day long.

   For the one all-day rule a parent *does* want to switch from the card, they pick it in the
   group's Edit sheet as the **Block button default**. From then on, Unblock lifts Video for the TV
   with a timer, and Block puts it back. Before this setting existed, parents turned the Video rule
   off, which has no timer and changes it for every group.
6. **"The default never takes over the button's meaning."** The button still reads only Block,
   Unblock or Resume, and it never names the rule. With a default set, Unblock still lifts everything
   that is blocking. The default only adds one more thing to that list, and when it is the only thing
   blocking, the button acts on it alone. Block internet stays in the dropdown, so cutting off all
   internet is always one tap away.
7. **"Outside the app, block means the internet."** Siri's Block and the Control Center / Quick
   Settings switch always block all internet, so they always agree with the badge. Siri's Unblock is
   the same group unblock as the card's, so it lifts the default too.

## The rules

Code: `src/lib/group-actions.ts` (`rulesToUnblock`, `groupHeaderActions`, `groupMenu`,
`groupStatusParts`), `src/lib/group-writes.ts` (`runGroupCardAction`), and on the server
`src/server/group-unblock.ts`, `group-internet.ts` and `group-rule-block.ts`. Every case below is a
vector in `tests/fixtures/display-vectors.json`, which the web, the app, the Apple Watch
(`Display.swift`) and Wear OS (`Display.kt`) all replay. Change a rule here, in the code and in the
vectors together, then port it to both watches.

### Words used below

- **D**: the group's Block button default, `blockButtonRule(G)`. It is `G.blockButtonRuleId` while
  that is still one of the group's own category, app or website rules. Otherwise there is no D, and
  the button works on all internet.
- **All-day rule** (`standingRule`): a category, app or website rule with `mode: "always"`. An
  always-on *internet* rule is not one: it blocks the internet, so it always counts.
- **Pause**: the group's own block of all internet (`G.suspension`).
- **Rule block**: the group's own block of D now, whatever D's schedule says (`G.ruleBlock`). The
  pause and the rule block are the same hidden rule, so turning one on turns the other off.
- Two kinds of lift, both for this group only and both leaving the rule unchanged for everyone else:
  - **Rule lift** (`groupLift().kind === "pause"`): one rule lifted from its own sheet. It is undone
    with "Block <rule> again" or the button's Block.
  - **Unblock lift** (`kind === "allow"`): made by the group unblock, one per rule. They are undone
    together by Resume.

### 1. What counts as blocking

A rule is **blocking** the group when all of these hold:

- it covers the group and is enabled;
- it is not paused for everyone, and has no lift for this group;
- one of its windows is active now (an always-on rule's window always is);
- it is not an all-day rule, **unless it is D**.

In code this is `rulesToUnblock(G)`. The badge, the status line and the button read only this list.
The pause and the rule block are tracked separately, on the group.

D counts like a scheduled rule even when it is all day. That is the whole point of choosing it
(story 5).

### 2. The badge

The badge reads **Blocked** when the group is paused, or when an internet rule is blocking. In every
other case it reads **Online**, including while a category rule, D or the rule block blocks (story 1).
The Block switch outside the app is on exactly when the badge reads Blocked.

### 3. The button

The first row that matches wins:

| # | When | Button | What the tap does |
| --- | --- | --- | --- |
| A | The group is paused | **Unblock** | Group unblock sheet. Ends the pause, and lifts whatever else is blocking. With nothing else blocking, it unblocks at once. |
| B | There is a D, and nothing other than D is blocking | | The button acts on D alone: |
| B1 | ・ the rule block is on | **Unblock** | Ends the rule block at once. |
| B2 | ・ D is blocking | **Unblock** | Sheet "Unblock Video for TV?". Lifts D for this group (a rule lift). |
| B3 | ・ D has a rule lift | **Block** | Puts D back at once. |
| B4 | ・ an unblock is running | **Resume** | Ends the unblock at once. |
| B5 | ・ otherwise (D is scheduled and outside its window) | **Block** | Sheet "Block Video for TV?". Turns the rule block on. |
| C | The rule block is on for a rule that is no longer D, and nothing is blocking | **Unblock** | Ends that rule block at once. (This happens if the default was changed mid-block. The server also ends it then, so this case is a fallback.) |
| D | Something is blocking | **Unblock** | Group unblock sheet. |
| E | An unblock is running | **Resume** | Ends the unblock at once. |
| F | Nothing | **Block** | Block sheet. Pauses all internet. |

**More time** shows beside A, B1, B3, B4 and E when what they show has an end time, and opens a sheet
that extends it.

Row B applies only while D is the *only* thing blocking. If Gaming's window or an internet rule
blocks too, row D applies instead, and a single Unblock lifts all of them together, D included
(story 3).

**What the group unblock lifts** (`runGroupUnblock`): every rule covering the group that is enabled,
not paused for everyone, not already rule-lifted, and not an all-day rule unless it is D. Lock DNS and
Block countries are never lifted. With no time chosen, only the rules blocking now are lifted, each
until its window ends. With a time, every one of those rules is lifted until then. The group unblock
also ends the pause or the rule block. If there is nothing to lift, the server answers 409
`not_blocked`.

### 4. The dropdown

A caret beside the button opens the dropdown. It is there while the button acts on D (rows B and C), or
while some category, app or website rule other than the button's is blocking or lifted for the group.
A blocking all-day rule counts here too, which is how a parent can still lift Social for a while. It
lists:

1. **Block internet**, unless the internet is already blocked (paused, or an internet rule blocks),
   or the button itself is already plain Block for all internet (row F).
2. **Unblock <rule>**: one item per rule blocking now, including all-day rules. Internet rules come first, then scheduled rules, then all-day
   rules. Each item lifts only that rule (a rule lift). Two rules are left out: the rule the button
   acts on, and, when the button is the group Unblock and exactly one scheduled rule is blocking,
   that one rule, since the button already lifts exactly it.
3. **Block <rule> again**: one item per rule with a rule lift, other than the button's rule. It puts
   that rule back at once.

### 5. The line under the name

The first case that matches wins. A grey line means the rules are doing what they always do. Red
means someone blocked the group, and green means someone lifted a block.

| # | When | Line | Colour |
| --- | --- | --- | --- |
| 1 | Paused | "Until 6:00 PM by Sam" / "Until you unblock, by Sam" | red |
| 2 | An internet rule is blocking | "Dinner until 8:00 PM" / "Dinner · always" | grey |
| 3 | The rule block is on | "Video blocked until 1:00 PM by Sam" / "Video blocked by Sam until you unblock" | red |
| 4 | Anything is blocking | "Gaming blocked until 12:00 PM". When several rules block, they are joined ("Video and Gaming blocked"), with the latest end time, and with no time if one never ends. | grey |
| 5 | D has a rule lift | "Video unblocked until 10:00 AM by Sam" / "… until you block it again" | green |
| 6 | An unblock is running | "Unblocked until 8:00 PM by Sam" | green |
| 7 | The internet rule is paused for this group, or for everyone | "Internet rule paused until …" | green |
| 8 | Otherwise | The internet schedule: the next window ("Dinner at 6:00 PM"), or "No internet rule". With a D and no internet rule: "Video at 9:00 PM" if D blocks within a day, otherwise "Video not blocked". | grey |

D is named by its category ("Video") when that is all it blocks, and by the rule's own name
otherwise. If two of the group's choices would read the same, both use their rules' own names.

## Examples (acceptance tests)

TV has Video (all day), Social (all day) and Gaming (scheduled 10:00 AM to 12:00 PM), and no internet
rule. Sam is the parent. Each row below was checked against `groupHeaderActions` and
`groupStatusParts`.

| Default | State | Badge | Line | Button | Dropdown |
| --- | --- | --- | --- | --- | --- |
| none | 9:00 AM | Online | No internet rule | **Block**: pauses all internet | Unblock Video, Unblock Social |
| none | 11:00 AM | Online | Gaming blocked until 12:00 PM | **Unblock**: lifts Gaming; Video and Social stay | Block internet, Unblock Video, Unblock Social |
| Video | 9:00 AM | Online | Video blocked | **Unblock**: "Unblock Video for TV?" | Block internet, Unblock Social |
| Video | 9:00 AM, Video unblocked for an hour | Online | Video unblocked until 10:00 AM by Sam | **Block** + More time: puts Video back | Block internet, Unblock Social |
| Video | 11:00 AM | Online | Video and Gaming blocked | **Unblock**: lifts Video and Gaming together; Social stays | Block internet, Unblock Video, Unblock Social |
| Video | 11:00 AM, Video already unblocked | Online | Gaming blocked until 12:00 PM | **Unblock**: lifts Gaming; Video keeps its own timer | Block internet, Unblock Social, Block Video again |

In the 11:00 AM row with Video as the default, the dropdown leaves out Gaming but lists Video. The
skip in dropdown item 2 looks only at scheduled rules, and Video is an all-day rule even when it is D.
Unblock Video there lifts Video alone, for a while.
