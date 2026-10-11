# Naming

> **Decided (2026-10-11): the game is called _Steel Diamond_** — the steel ball on the baseball
> diamond. It replaced *Rally Ball* (M3) after the M6 name check found an existing mobile game with
> that name. Round 3 and the checks are at the bottom. "BasePinball" remains the repository and
> project name.

The candidates considered are below.

![Name candidates](assets/name-candidates.png)

| # | Name | For | Against |
|---|------|-----|---------|
| 1 | **Extra Innings** | A double meaning: pinball's *extra ball* and baseball's *extra innings*. Short, memorable, upbeat. | A common phrase, so the exact name may be hard to own. Needs a trademark and store search. |
| 2 | **Night Game** | Matches the art direction and the mood. Simple. | Doesn't say "pinball". Generic. |
| 3 | **Silverball Classic** | "Silverball" is classic pinball slang, and it ties to the Silverballs team | Longer. "Classic" is weak. |
| 4 | **Plunger Park** | The ballpark in the game. Playful, distinctive, likely ownable. | Reads as a place before a game |
| 5 | **Diamond Flip** | Two words, baseball plus pinball | A little abstract |
| 6 | **BasePinball** | Says exactly what it is | Functional more than evocative |

**Recommendation: Extra Innings** (or *Plunger Park* if Extra Innings turns out to be taken).

**Before locking the name:** check trademark databases, app stores and domains. None of this
has been checked. The name lives in one place in code (`src/app/brand.ts`, plus the `<title>` in
`index.html`), so changing it is a one-line edit, and the scoreboard, title screen and box score
follow it.

## Round 3 (after dropping Rally Ball)

A quick web search was run on the leading candidates (not a trademark clearance):

| Name | Idea | Quick check |
|---|---|---|
| **Pinfield** | Pin(ball) + infield | No game found. "Pinfall" (a 2026 pinball game) sounds close. |
| **Steel Diamond** | The steel ball on the diamond | No game found |
| **Plunger Park** | The game's ballpark (round 1) | No game found |
| **Dingerball** | A dinger is a home run | No game found |
| **Twin Bill** | A doubleheader, and two flippers | No game found; a common phrase |
| **Nightcap** | The second game of a doubleheader, and a night game | No baseball game found; a common word |
| **Pop Fly** | Pop bumpers plus a pop fly (round 2) | No pinball game found |

**Ruled out by the check:**
- *Rally Ball*: an existing mobile game.
- *Extra Innings*: a 1991 SNES baseball game, and Gottlieb's "Extra Inning" pinball machine.
- *Bat Flip*: a 2022 baseball card game.
- *Walk-Off*: "Walk-Off 199X", and MLB's Daily Walkoff.
- Anything with *Silverball*: a 1993 pinball video game.

### Steel Diamond: deeper check (2026-10-11)

Not a legal clearance; have counsel run a proper search (classes 9 and 41) before marketing.

| Check | Result |
|---|---|
| Trademarks (web search of USPTO mirrors) | No "STEEL DIAMOND" mark found. An expired 1941 "STEEL" mark for steel sheet used a diamond design, which is not relevant. |
| Games and apps (web, Steam, itch.io, app stores) | No game or app named Steel Diamond found |
| Domains | `steeldiamond.com` has been registered since 2015 (NameBright, likely parked). `steeldiamond.gg`, `.io` and `.app`, `steeldiamondgame.com` and `playsteeldiamond.com` have no DNS and appear unregistered. |
