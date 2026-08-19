# Inflate — Manual

Make a flat shape look like it was blown up with air.

Inflate takes whatever you have selected and grows each shape by the room inside it. A fat body
swells. A thin arm barely moves. The edges between corners bow outward, holes close up, and points
soften. What comes back is still the shape you drew — the same nodes, in the same order, editable
exactly as before.

It is one undo step. If you do not like it, undo once and everything is back.

> This is a development build. Everything described here has been measured rather than assumed, but
> expect rough edges — the [Limits](#limits) section is honest about them.

---

## Contents

- [Installing](#installing)
- [Quickstart](#quickstart)
- [The two settings](#the-two-settings)
- [What it does to different shapes](#what-it-does-to-different-shapes)
- [Recipes](#recipes)
- [When nothing happens](#when-nothing-happens)
- [Limits](#limits)

---

## Installing

Inflate runs in **Affinity by Canva** through the Scripts panel.

1. Open the Scripts panel: `Window → General → Scripts`.
2. Create a category if you do not have one — Affinity will not register a script without one.
3. Add `inflate.js` as a new script.

---

## Quickstart

**1. Convert your shape to curves.** `Layer → Convert to Curves`, or `⌘⇧C` / `Ctrl+Shift+C`. Inflate
only moves anchor points, and a live rectangle or a live text frame has none to move — it will be
skipped, and told so in the console.

**2. Select it and run Inflate.**

**3. Set how much, and press OK.** 30% is a gentle puff. 100% doubles the thickness of the shape
across a flat span.

That is the whole thing. Re-run it to compound; undo to dial back.

---

## The two settings

### Inflate %

How far to grow, as a percentage of the shape's **own local thickness**. That is what makes it look
inflated rather than merely fatter: a wide body has more room inside it than a narrow one, so it
grows more.

At **100%** the shape doubles in thickness across a flat span — a bar 40 units wide comes out 80.
The percentage means the same thing on a 20pt letter and a 2000pt shape.

Corners are a special case. A corner grows *less* than the flat edges beside it — that shortfall is
what makes the edges read as bulging and the corners as pinched, and it is the difference between
this and a plain outline offset.

### Round corners %

How much to soften sharp points, as a percentage of how far the shape puffed at that corner.

At **0** rounding is off, and sharp corners stay sharp. That is what the geometry does unaided: this
never adds a node, so a corner stays a corner however much the shape swells.

At **90%** (the default) a sharp point is rounded with a radius about as big as the puff itself,
which is what a real inflated object does. Turn it up for softer, blobbier points; the slider runs
to 200% because a corner can legitimately be rounded harder than the shape grew.

Only genuinely sharp corners are touched — anything blunter than about 85 degrees is left alone, so
a square keeps its square corners at every setting. Notches are left alone too: rounding a notch
fills it in, which is a different effect.

---

## What it does to different shapes

| You have | You get |
|---|---|
| A rectangle or square | Edges bow outward, corners stay comparatively pinched |
| An ellipse | Grows more across its narrow axis than its long one, because that is where the room is |
| A polygon | Every edge bulges; sharp points round off if rounding is on |
| A letter with a counter — **O**, **A**, **R**, **B** | The letter thickens and the counter closes up, as a real puffy letter does |
| A star | The points keep their length and thicken; the notches between them stay crisp |
| An open path | Comes back untouched. An open path encloses no material, so there is nothing to inflate |

---

## Recipes

### A puffy sticker letter

Convert to curves, run at **50–70%** with rounding at **90%**. The counters will close noticeably —
that is correct, and it is what makes it read as inflated rather than bold. If a counter closes more
than you want, use a lower percentage rather than turning rounding down; the two are unrelated.

### Keep the shape crisp, just fatter

Rounding at **0**. Corners stay exactly as drawn and only the edges bow. Good for geometric marks
where a rounded corner would look like a mistake.

### A soft blob

Run at **100%** with rounding at **150–200%**. Points disappear almost entirely.

### Build it up gradually

Run at 20% several times rather than 60% once. Each run measures the shape as it is *now*, so the
result differs from a single larger run — the thickness it scales by has grown too. Undo steps back
one run at a time.

### Inflate several shapes at once

Select them all and run. Each is measured and grown on its own, keeps its own node count, and the
whole selection is a single undo step. A shape and its counters are always rebuilt together.

---

## When nothing happens

**"Select one or more vector (curve) shapes first."** Nothing in your selection has editable
anchors. The usual cause is a live shape or live text — run `Convert to Curves` and try again.

**Some shapes changed and others did not.** The ones that did not are live shapes, and each is named
in the console (`Window → General → Console`) with the reason. A group is also skipped: select the
shapes inside it rather than the group.

**A shape came back identical.** If it is an open path, that is expected — an open path encloses no
material. Otherwise check the console; a shape with no enclosed area, such as a line doubled back on
itself, is copied through untouched and says so.

**Something looks pinched or capped.** The console reports it. Inflate refuses to let a shape
destroy itself: a small feature between two thick limbs will not collapse to nothing, and a hole
will not close past its own width. Each time it holds something back it says which shape and by how
much. Lower the percentage if you see many of those.

---

## Limits

**Node count never changes.** That is the point — the shape stays editable as the one you drew — but
it means a single curve between two anchors has to carry the whole bulge along that edge. On a long
edge whose thickness varies a lot, that bulge is approximated rather than exact.

**Corners are not rounded unless you ask.** With rounding at 0 a sharp point stays a sharp point at
any percentage, because rounding a corner needs curvature at the node and this never adds nodes.

**High percentages on small holes.** A counter closes by the thickness of the wall around it, which
has nothing to do with the size of the hole. On a letter whose wall is much thicker than its counter
is wide, the counter would close completely well before 100%. It is held open instead, and the
console says so — but the shape at that point is past what the effect can express, and a lower
percentage will look better than a capped high one.

**Very thin artwork.** Everything scales with the shape, so a hairline works the same as a poster.
But a shape thinner than the flattening tolerance has little room to be measured in, and results
there are less reliable than on artwork you can see.

**Self-intersection is not repaired.** Real artwork stays clear of it at 100%, but a sufficiently
thin crescent or S-curve can still swallow its own concavity at high percentages. Undo and use less.
