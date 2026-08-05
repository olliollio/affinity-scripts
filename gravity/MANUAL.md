# Gravity — Manual

Drop your artwork and let it fall.

Gravity takes whatever you have selected, works out its real outline — curves, counters, holes and
all — and drops it into a physics simulation. Letters land on letters. A shape with a hole in it
lands *around* what it falls onto. Open paths become ropes that drape. The result plays out on
canvas, you scrub to the frame you like, and that frame stays.

It is one undo step. If you do not like it, undo once and everything is back.

> This is a development build. It works, and everything described here has been measured rather
> than assumed, but expect rough edges — the [Limits](#limits) section is honest about them.

---

## Contents

- [Installing](#installing)
- [Quickstart](#quickstart)
- [Recipes](#recipes)
- [What becomes what](#what-becomes-what)
- [Naming and locking](#naming-and-locking)
- [Every setting](#every-setting)
- [Reading the report](#reading-the-report)
- [Limits](#limits)

---

## Installing

Gravity runs in **Affinity by Canva** through the Scripts panel.

1. Open the Scripts panel: `Window → General → Scripts`.
2. Create a category if you do not have one — Affinity will not register a script without one.
3. Add `gravity.js` as a new script.

`[screenshot: the Scripts panel with Gravity listed in a category]`

**Install it properly, do not just test it.** Affinity has a testing environment for scripts, and
Gravity runs there — but exporting an image sequence is blocked in it and fails with a permission
error. The same file installed as a script exports normally. If an export ever fails, check this
first, before anything else.

---

## Quickstart

**1. Select the artwork you want to drop.** Anything vector, any number of objects. Live text is
fine and stays editable.

**2. Select the artwork you want it to land on too** — and lock those layers. Locked artwork
becomes scenery: it collides but never moves. Without something to land on, your objects fall until
the clock runs out.

**3. Run Gravity.** The settings dialog opens.

`[screenshot: the settings dialog, all three groups visible]`

**4. Press OK and watch.** The drop plays on canvas in real time.

**5. Pick your frame.** When it finishes, a second dialog appears with a Frame slider. Drag it and
the canvas updates to that moment.

`[screenshot: the Finished dialog with the Frame slider]`

- **OK** keeps the frame you are looking at.
- **Cancel** keeps the settled result — the last frame — rather than throwing the drop away.

**6. Undo if you want it gone.** The whole thing is a single undo step.

---

## Recipes

### Make something scenery it lands on

Two ways, either works:

- **Lock the layer.** Simplest, and it is the one to reach for.
- **Name it** `wall`, `floor`, `ramp`, `ground`, `static` or `collider`.

Scenery collides but never moves, however hard it is hit. A bowl, a table edge, a word you want
other words to pile onto — all scenery.

`[screenshot: before and after — letters piled inside a locked bowl shape]`

### Hang a rope instead of dropping it

Any **open path** — one that is not closed — becomes a rope: a chain of linked segments that bends
and drapes rather than falling as a rigid stick.

By default both ends are free and the whole rope falls. To pin the ends so it hangs, put `hang`,
`pin` or `anchor` in the object's name.

**Then give it slack, or it will not hang.** A path drawn as a straight line is exactly as long as
the gap between its ends, so there is nothing spare to drape with — pin it and you get a shallow
bow, which is physically correct and not what anyone wants. **Rope slack %** tells Gravity the rope
is longer than it looks. On a 1640pt line pinned at both ends:

| Rope slack % | How far it hangs |
|---|---|
| 0 | 105pt — barely a bow |
| 10 | 328pt |
| 20 | 466pt |
| 35 | 645pt |

Gravity checks how much clear room is under the rope and hangs it as far as that allows. With
nothing below, it starts as a clean curve. With artwork below, it starts above that artwork so it
still lands on it — and if you have asked for more slack than the gap can hold, the surplus shows as
a ripple for the first second or so. On a rope with artwork about 500pt beneath it, 10% starts
smooth and 25% starts visibly bunched. That is the rope not fitting, not a fault.

The ends stay exactly where you drew them at any setting. The rope starts as a shallow ripple along
the path rather than as the straight line you drew — a rope that is longer than the gap between its
ends has to put that extra length somewhere, and the first frame is where it goes. It stays close to
your path, so it still falls onto whatever you drew it over.

If you would rather not use the setting, draw the path as a curve that is genuinely longer than the
gap between its ends. That has always worked and needs nothing switched on.

The path Gravity draws back is smoothed, then tidied: points that sit on a curve already described
by their neighbours are dropped, to a fraction of a point. A deep drape therefore comes back with
more nodes than a shallow one, and only a rope that genuinely ended up straight comes back simple.

> A rope pinned with **no** slack is simulated at lower resolution — about a third as many segments.
> A rope pulled tight is far harder to solve than a slack one, and past a certain segment count a
> taut rope tears itself apart. Give it slack and most of that resolution comes back, because the
> slack is what stops the tension building. The drawn curve stays smooth either way.

### Drop a word letter by letter

Live text drops as **one piece** by default, because Affinity treats a text object as a single
thing and Gravity has to move it as one.

Tick **Split text into letters** and each letter falls on its own.

> This converts your text to curves and it is no longer editable text afterwards. It is still one
> undo step, so you can back out — but if you want to keep the text live, leave it off.

### Stop big artwork bulldozing small artwork

Mass grows with area, so a placed photo can outweigh a letter by ninety times and simply shove it
out of the way.

Tick **Equalise mass** and every object is given comparable weight regardless of size. Small
artwork stops being furniture.

### Keep a group falling as one piece

By default the objects in a group fall independently. Tick **Keep groups as one object** and the
group lands as a single rigid piece.

### Get the same result twice

The same artwork with the same **Seed** always produces exactly the same drop. Nothing is random
between runs.

If you like a result, note the seed. If you want a different one, change the seed and run again —
that is what it is for. Changing gravity, bounce or friction will also change the outcome, but seed
is the knob for "same settings, different luck".

### Export an image sequence

Tick **Export image sequence** in the settings dialog. When the drop finishes, the Finished dialog
gains a format choice — PNG or JPEG.

Scrub to the last frame you want, choose a format, and press OK. Gravity writes frames from the
start of the drop up to the frame you kept, at 30fps, into a new folder on your Desktop.

- **Cancel does not export.** It means "keep the settled result", not "write three hundred files".
- **Do not touch the document while it runs.** Every frame is a real export and it takes a while.
- **Install the script first.** Export is blocked in the testing environment.

Import the folder as an image sequence at 30fps.

### See what Gravity thinks without touching your document

Tick **Dry run, report only**. Gravity reads the selection, prints its full report to the Scripts
panel console, and stops. Nothing plays, nothing exports, your document is untouched.

Useful when a drop behaves oddly and you want to compare two runs — an ordinary run ends by keeping
a frame, so the *next* run would be reading the result of the last one.

---

## What becomes what

| You select | Gravity makes |
|---|---|
| A closed path or shape | One falling object, with its real outline including holes |
| An **open** path | A rope — a flexible chain that drapes |
| Live text | One falling object, unless you tick Split text into letters |
| A group | One object per member, unless you tick Keep groups as one object |
| A placed image | A falling object shaped like the image's **visible silhouette**, traced from its transparency |
| Anything locked or named as scenery | Immovable scenery |

Holes are real. A letter "O" dropped into a bowl falls *through* its own counter rather than
resting on it, and a ring lands around a peg rather than on top of it. This is unusual — most
physics tools cannot do it — and it is the reason the script exists.

`[screenshot: an "O" landed around a post, showing the counter is a real hole]`

A fully opaque image has no silhouette to trace, so it behaves as its rectangle. That is correct,
not a failure.

---

## Naming and locking

Two sets of words, matched in the object or layer name. Case does not matter.

| Word in the name | Effect | Applies to |
|---|---|---|
| `wall` `floor` `ramp` `ground` `static` `collider` | Becomes scenery: collides, never moves | Anything |
| `hang` `pin` `anchor` | Pins the ends so it hangs | Open paths only |

Locking a layer does the same as the scenery words, and is usually easier.

**Words are matched whole.** `Wall 3` and `left-wall` are scenery. `Wallpaper` is not. Same rule
for the anchor words: a path called `hanging cable` is pinned, one called `Shanghai` is not.

---

## Every setting

### Simulation

| Setting | Default | What it does |
|---|---|---|
| **Gravity** | 1000 | Strength of the pull, in document units per second squared. Lower feels like the moon; higher makes everything slam down. |
| **Angle** | 0 | Which way is down. `0` is down the page, `90` is to the right, `180` is up. |
| **Max duration** | 10s | How long the drop is allowed to run. It stops early once everything comes to rest. |
| **Seed** | 1 | Same artwork plus same seed equals the same drop, always. Change it for a different result from identical settings. |

### Material

| Setting | Default | What it does |
|---|---|---|
| **Bounciness %** | 15 | How much objects bounce. 0 is a beanbag, high values make things skitter for a long time. |
| **Friction %** | 40 | How much they grip. Low values make piles slide apart; high values let them stack. |
| **Equalise mass** | off | Gives every object comparable weight regardless of size, so large artwork stops bulldozing small artwork. |
| **Rope slack %** | 0 | How much longer than it looks a rope is. 0 leaves ropes exactly as drawn, so a straight pinned line cannot drape. Raise it to make ropes hang. |

There is deliberately no density control. One density applied to everything leaves every weight
*ratio* unchanged, and collisions only depend on ratios — so it would do nothing at all. Equalise
mass is the control that actually changes the balance.

### Objects

| Setting | Default | What it does |
|---|---|---|
| **Split text into letters** | off | Converts text to curves so each letter falls separately. The text is no longer editable afterwards. |
| **Keep groups as one object** | off | A group lands as a single rigid piece instead of falling apart. |
| **Export image sequence** | off | Offers PNG/JPEG export in the Finished dialog when the drop ends. |
| **Dry run, report only** | off | Prints the report and stops. Nothing plays, nothing is exported, the document is untouched. |

---

## Reading the report

Gravity writes to the Scripts panel console as it works. You can ignore all of it when a drop looks
right — it is there for when one does not.

**`== extracted ==`** — one line per object, showing what Gravity found. `rings` is the number of
closed outlines, `holes` the number of counters inside them. A line reading `rings=0` is an open
path, so it will be a rope. `STATIC` means scenery.

If you see **`SUSPECT`** on a line, Gravity's idea of where an object is disagrees with Affinity's.
That is a bug worth reporting, and the line says whether the disagreement is in size or position.

**`== bodies ==`** — what got built. `body` is a falling object, `rope` is a chain (with its segment
count), `static` is scenery. Anything listed as `SKIPPED` had geometry Gravity could not use.

**`== simulation ==`** — how the run ended. This is the useful one:

- **`settledBy=sleep`** — everything came to rest on its own. The ideal.
- **`settledBy=quiescence`** — everything stopped moving, but something is wedged inside scenery so
  it could never properly come to rest. Usually means artwork was overlapping its container at the
  start.
- **`settledBy=cap`** — time ran out before things settled.

`cap` is followed by an explanation of what was still moving:

```
did NOT settle: 168/168 bodies still awake, 11 over the sleep tolerance
fastest 1.826 pt/s (Curve [8]), spin 0.1127 rad/s  — tolerance is 1.000 pt/s and 0.0349 rad/s
```

Read it as: how many objects are still in motion, how fast the fastest one is, and what counts as
"still". If the speeds are far above the tolerance, the scene genuinely has not landed yet — raise
Max duration. If they are barely above it, the drop is visually finished and you can simply keep
the frame.

**`== final poses ==`** — where everything ended up. Mostly of interest when comparing two runs.

---

## Limits

**Long ropes take a long time to settle, and `cap` is normal.** A rope is dozens of linked
segments, and a run only ends when *every* one of them is still at the same moment. A rope draped
over lettering can look completely at rest while a few segments creep imperceptibly. The drop is
fine — keep the frame you like.

**A pinned rope keeps swinging.** A hanging rope is a pendulum, and a pendulum takes a long time to
stop. Expect `settledBy=cap` on a scene that is mostly rope, and keep the frame you like.

**Very thin artwork is unstable.** Below roughly 5pt at typical sizes, a shape is thin enough that
the physics engine cannot hold it steady and it will jitter or sink slightly into what it lands on.
Hairlines and fine serifs are the usual casualties.

**Artwork that starts inside its container never truly rests.** If a shape overlaps scenery at
frame 0, it spends the whole run being pushed out and can never come to rest. Gravity notices and
says so. Move the artwork clear of the container before running.

**Export needs an installed script.** Not the testing environment. This is an Affinity restriction,
not a Gravity one.

**A rope-only scene is simulated at a default scale.** Gravity normally sizes the simulation to your
artwork, but ropes are not counted when it does. A scene of nothing but ropes still works — it is
just not tuned to its own dimensions.

**Small changes can produce large differences.** A scene of long ropes draped over lettering is
genuinely chaotic: nudge one object and the whole pile can land differently. The same input always
gives the same output, but "similar input gives similar output" is not something physics promises.
