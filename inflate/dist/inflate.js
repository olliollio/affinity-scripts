/**
 * name: inflate
 * description: Give a flat vector shape the look of an inflated pillow.
 * version: 1.0.0-dev
 * author: ollio
 *
 * GENERATED FILE - do not edit. Built from inflate/src/ (and gravity/src/, reused by
 * path) by inflate/build.js. Edit the sources and rebuild; the real diff lives in src/.
 *
 * The reused gravity modules carry comments about planck.js and earcut - gravity's
 * vendored libraries. inflate bundles neither; those comments describe gravity, not this file.
 */

'use strict';

var GR = {};

// -------------------------------------------------------------------------
// ../gravity/src/contours.js
/**
 * contours.js — pure geometry. Ring orientation, containment, nesting depth -> faces.
 *
 * A "ring" is a flat, implicitly-closed array of coordinates: [x0, y0, x1, y1, ...].
 * No Affinity API here: plain numbers in, plain numbers out, node-testable.
 */

(function (GR) {
  'use strict';

  // Shoelace. Positive == counter-clockwise in the coordinate values themselves; the caller
  // decides whether that reads as clockwise on a y-down canvas.
  function signedArea(ring) {
    var n = ring.length >> 1;
    if (n < 3) return 0;
    var sum = 0;
    var jx = ring[(n - 1) * 2], jy = ring[(n - 1) * 2 + 1];
    for (var i = 0; i < n; i++) {
      var ix = ring[i * 2], iy = ring[i * 2 + 1];
      sum += (jx - ix) * (jy + iy);
      jx = ix; jy = iy;
    }
    return sum / 2;
  }

  // Crossing-number ray cast along +x. The half-open `(yi > y) !== (yj > y)` rule counts a
  // vertex for exactly one of its two edges, so a ray that grazes a vertex is not double-counted.
  // Points exactly on the boundary are deliberately unspecified — callers classify rings by a
  // majority vote over several samples rather than trusting one boundary case.
  function pointInRing(ring, x, y) {
    var n = ring.length >> 1;
    if (n < 3) return false;
    var inside = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = ring[i * 2], yi = ring[i * 2 + 1];
      var xj = ring[j * 2], yj = ring[j * 2 + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Is `inner` nested inside `outer`? Font outlines never self-intersect, so one sample would
  // usually do — but coincident vertices where two contours touch make a single sample a coin
  // flip. A majority vote over a spread of vertices is O(1)-ish and immune to that.
  function ringInRing(inner, outer) {
    var n = inner.length >> 1;
    var step = Math.max(1, Math.floor(n / 7));
    var votes = 0, total = 0;
    for (var i = 0; i < n; i += step) {
      total++;
      if (pointInRing(outer, inner[i * 2], inner[i * 2 + 1])) votes++;
    }
    return votes * 2 > total;
  }

  /**
   * Groups rings into faces by nesting depth: even depth is solid, odd depth is a void.
   *
   *   "O"  ->  1 face, 1 hole          "i"  ->  2 faces, no holes
   *   "B"  ->  1 face, 2 holes         a dot inside a counter -> 2 faces (depth 2 is solid again)
   *
   * A hole attaches to its *innermost* container, so a counter inside an island cannot punch a
   * phantom void through the outermost ring. Input winding is irrelevant; rings are returned by
   * reference, unmodified — normalising them is sanitize's job.
   *
   * @param  {number[][]} rings  flat, implicitly-closed coordinate arrays
   * @return {{outer: number[], holes: number[][]}[]}  faces in input order of their outer ring
   */
  function buildFaces(rings) {
    var valid = [];
    var i, j;
    for (i = 0; i < rings.length; i++) {
      if (rings[i] && (rings[i].length >> 1) >= 3) valid.push(rings[i]);
    }

    var n = valid.length;
    var depth = new Array(n);
    var containers = new Array(n);
    for (i = 0; i < n; i++) { depth[i] = 0; containers[i] = []; }

    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if (i !== j && ringInRing(valid[i], valid[j])) { depth[i]++; containers[i].push(j); }
      }
    }

    // Innermost container = the one with the greatest depth; ties break to the smaller ring.
    var faces = [];
    var faceOf = new Array(n);
    for (i = 0; i < n; i++) {
      faceOf[i] = -1;
      if (depth[i] % 2 === 0) { faceOf[i] = faces.length; faces.push({ outer: valid[i], holes: [] }); }
    }

    for (i = 0; i < n; i++) {
      if (depth[i] % 2 === 0) continue;
      var best = -1;
      for (j = 0; j < containers[i].length; j++) {
        var c = containers[i][j];
        if (best === -1 || depth[c] > depth[best] ||
            (depth[c] === depth[best] && Math.abs(signedArea(valid[c])) < Math.abs(signedArea(valid[best])))) {
          best = c;
        }
      }
      if (best !== -1 && faceOf[best] !== -1) faces[faceOf[best]].holes.push(valid[i]);
    }

    return faces;
  }

  GR.signedArea = signedArea;
  GR.pointInRing = pointInRing;
  GR.ringInRing = ringInRing;
  GR.buildFaces = buildFaces;

})(GR);

// -------------------------------------------------------------------------
// ../gravity/src/flatten.js
/**
 * flatten.js — cubic beziers to polygon rings. Pure geometry.
 *
 * Affinity hands geometry over as cubic beziers; planck needs straight-edged rings. This module
 * does that conversion on plain numbers, which keeps it on the testable side of the split — the
 * Affinity layer only has to hand over four points per segment.
 *
 * Subdivision is adaptive on FLATNESS rather than uniform in the parameter t. Cubics are not
 * constant-speed, so uniform t bunches points towards the ends of every segment: a long gentle
 * curve gets the same point count as a short sharp one, and both get them in the wrong places.
 * Flatness-based recursion spends points where the curve actually bends.
 */

(function (GR) {
  'use strict';

  // Chord deviation, in source units, under which a segment is emitted as a straight line. This is
  // deliberately finer than the Douglas-Peucker tolerance that runs afterwards: flattening should
  // not decide what is worth keeping, it should only stop being wrong. sanitize.js then removes
  // what the shape does not need.
  var FLATTEN_TOL = 0.1;

  // Recursion guard. 16 subdivisions is 65536 segments for one bezier, far past anything a real
  // outline needs; hitting it means degenerate control points rather than genuine detail.
  var MAX_DEPTH = 16;

  // Control handles this close to their anchor mean the segment is stored as a cubic but is
  // actually a straight line. Affinity stores every straight edge that way, so this is the common
  // case, not an optimisation for rare input.
  var LINE_EPS = 1e-9;

  function isLine(x0, y0, c1x, c1y, c2x, c2y, x3, y3) {
    var dx = x3 - x0, dy = y3 - y0;
    var len2 = dx * dx + dy * dy;
    if (len2 <= LINE_EPS) {
      // Degenerate chord: only a line if the handles sit on the anchor too.
      return Math.abs(c1x - x0) <= LINE_EPS && Math.abs(c1y - y0) <= LINE_EPS &&
             Math.abs(c2x - x3) <= LINE_EPS && Math.abs(c2y - y3) <= LINE_EPS;
    }
    return Math.abs(c1x - x0) <= LINE_EPS && Math.abs(c1y - y0) <= LINE_EPS &&
           Math.abs(c2x - x3) <= LINE_EPS && Math.abs(c2y - y3) <= LINE_EPS;
  }

  /**
   * Is this cubic within `tol` of its own chord?
   *
   * Uses the standard control-point bound: the curve lies inside the convex hull of its control
   * points, so the larger of the two handles' distances from the chord bounds the true deviation.
   * Cheap, conservative, and needs no square roots until the very end.
   */
  function flatEnough(x0, y0, c1x, c1y, c2x, c2y, x3, y3, tol) {
    var dx = x3 - x0, dy = y3 - y0;
    var len2 = dx * dx + dy * dy;

    if (len2 <= LINE_EPS) {
      // A closed loop of zero chord length: fall back to raw handle distance from the anchor.
      var a1 = (c1x - x0) * (c1x - x0) + (c1y - y0) * (c1y - y0);
      var a2 = (c2x - x0) * (c2x - x0) + (c2y - y0) * (c2y - y0);
      return Math.max(a1, a2) <= tol * tol;
    }

    // Perpendicular distance of each handle from the chord, kept squared.
    var d1 = (c1x - x0) * dy - (c1y - y0) * dx;
    var d2 = (c2x - x0) * dy - (c2y - y0) * dx;
    var worst = Math.max(d1 * d1, d2 * d2);
    return worst <= tol * tol * len2;
  }

  /** De Casteljau split at t = 0.5, which is where an adaptive subdivision always splits. */
  function subdivide(out, x0, y0, c1x, c1y, c2x, c2y, x3, y3, tol, depth) {
    if (depth >= MAX_DEPTH || flatEnough(x0, y0, c1x, c1y, c2x, c2y, x3, y3, tol)) {
      out.push(x3, y3);
      return;
    }
    var ax = (x0 + c1x) / 2, ay = (y0 + c1y) / 2;
    var bx = (c1x + c2x) / 2, by = (c1y + c2y) / 2;
    var cx = (c2x + x3) / 2, cy = (c2y + y3) / 2;
    var dx = (ax + bx) / 2, dy = (ay + by) / 2;
    var ex = (bx + cx) / 2, ey = (by + cy) / 2;
    var mx = (dx + ex) / 2, my = (dy + ey) / 2;

    subdivide(out, x0, y0, ax, ay, dx, dy, mx, my, tol, depth + 1);
    subdivide(out, mx, my, ex, ey, cx, cy, x3, y3, tol, depth + 1);
  }

  /**
   * One cubic to points, appending everything AFTER the start point.
   *
   * The start is the caller's job because consecutive segments share an anchor; emitting it here
   * would duplicate every joint and sanitize.js would only have to strip them again.
   */
  function flattenCubic(out, x0, y0, c1x, c1y, c2x, c2y, x3, y3, tol) {
    var t = tol === undefined ? FLATTEN_TOL : tol;
    if (isLine(x0, y0, c1x, c1y, c2x, c2y, x3, y3)) {
      out.push(x3, y3);
      return out;
    }
    subdivide(out, x0, y0, c1x, c1y, c2x, c2y, x3, y3, t, 0);
    return out;
  }

  /**
   * A list of segments to one flat ring.
   *
   * `segments` is an array of `{start:{x,y}, c1:{x,y}, c2:{x,y}, end:{x,y}}` — the shape Affinity's
   * `curve.beziers` yields, reduced to plain numbers by the caller. The ring is implicitly closed,
   * matching the convention the rest of the pipeline uses, so the final point is dropped when it
   * coincides with the first.
   */
  function flattenSegments(segments, opts) {
    var o = opts || {};
    var tol = o.flattenTol === undefined ? FLATTEN_TOL : o.flattenTol;
    if (!segments || !segments.length) return [];

    var out = [];
    var first = segments[0];
    out.push(first.start.x, first.start.y);

    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      flattenCubic(out, s.start.x, s.start.y, s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.end.x, s.end.y, tol);
    }

    // Implicitly closed: drop a trailing point that repeats the first.
    if (out.length >= 4) {
      var n = out.length;
      if (Math.abs(out[n - 2] - out[0]) <= LINE_EPS && Math.abs(out[n - 1] - out[1]) <= LINE_EPS) {
        out.length = n - 2;
      }
    }
    return out;
  }

  /**
   * Applies a row-major 2x3 transform `[a, b, tx, c, d, ty]` to a ring, in place.
   *
   * This is how base-space curve coordinates become spread-space ones. The matrix comes from
   * `node.baseToSpreadTransform`, which is the only one of the three with the ancestors composed
   * into it. `node.transform` is the node's LOCAL matrix and `node.localToSpreadTransform` is the
   * parent chain without the node — either one alone lands the geometry in the wrong place as soon
   * as an ancestor carries a scale.
   */
  function transformRing(ring, m) {
    if (!m) return ring;
    var a = m[0], b = m[1], tx = m[2], c = m[3], d = m[4], ty = m[5];
    for (var i = 0; i < ring.length; i += 2) {
      var x = ring[i], y = ring[i + 1];
      ring[i] = a * x + b * y + tx;
      ring[i + 1] = c * x + d * y + ty;
    }
    return ring;
  }

  /**
   * The axis-aligned box a RECTANGLE occupies after a transform, as `{x0, y0, x1, y1}`.
   *
   * This is not the same thing as transforming a shape and boxing the result, and the difference is
   * the whole reason this exists. Affinity's `node.spreadBaseBox` is computed exactly this way —
   * the four corners of `node.baseBox` pushed through the matrix, then boxed — so it INFLATES under
   * rotation even when the artwork does not. A circle is the clearest case: rotate it and its true
   * box is unchanged, while its bounding square's box grows by `|cos t| + |sin t|`, up to 41% at
   * 45 degrees.
   *
   * Verified against six nodes from a real run, matching `spreadBaseBox` to within 0.18pt — which
   * is itself just the rounding in the 3-decimal matrix those numbers were read from.
   *
   * `box` is `{x, y, width, height}`, the shape Affinity's box objects have.
   */
  function boxUnderMatrix(box, m) {
    if (!box) return null;
    var x = box.x, y = box.y, w = box.width, h = box.height;
    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return null;
    // A null matrix means base and spread already agree, so the box passes through unchanged.
    var corners = [x, y, x + w, y, x, y + h, x + w, y + h];
    if (m) transformRing(corners, m);
    var x0 = corners[0], y0 = corners[1], x1 = corners[0], y1 = corners[1];
    for (var i = 2; i < corners.length; i += 2) {
      if (corners[i] < x0) x0 = corners[i];
      if (corners[i] > x1) x1 = corners[i];
      if (corners[i + 1] < y0) y0 = corners[i + 1];
      if (corners[i + 1] > y1) y1 = corners[i + 1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /**
   * Inverts a row-major 2x3 transform, so spread-space coordinates can be written back as base.
   *
   * Extraction only ever goes one way — base to spread — because a rigid body is moved with
   * `createTransform`, which already works in spread space and never needs the return trip. A ROPE
   * does need it: a rope deforms, so playback rewrites its geometry with `createSetCurves`, and
   * that writes into the node's own BASE space. Handing it spread coordinates displaces the rope by
   * exactly the node's own transform — invisibly correct on a node that has never been moved, and
   * wrong on every other, which is precisely how this surfaced.
   *
   * Returns null for a null or singular matrix. Singular means the node has been scaled to nothing
   * on some axis, and there is no sensible inverse to invent; callers fall back to writing the
   * points unchanged, which is what they did before this existed.
   */
  function invertMatrix(m) {
    if (!m) return null;
    var a = m[0], b = m[1], tx = m[2], c = m[3], d = m[4], ty = m[5];
    var det = a * d - b * c;
    if (!det || !isFinite(det)) return null;
    return [
      d / det, -b / det, (b * ty - d * tx) / det,
      -c / det, a / det, (c * tx - a * ty) / det
    ];
  }

  GR.flattenCubic = flattenCubic;
  GR.flattenSegments = flattenSegments;
  GR.transformRing = transformRing;
  GR.boxUnderMatrix = boxUnderMatrix;
  GR.invertMatrix = invertMatrix;
  GR.FLATTEN_TOL = FLATTEN_TOL;

})(GR);

// -------------------------------------------------------------------------
// ../gravity/src/softmesh.js
/**
 * softmesh.js — pure geometry for softbodies. A face becomes a lattice of nodes and springs.
 *
 * Everything here is in SIM units. The caller converts the face once on the way in, and nothing
 * downstream converts again — mixing point space and sim space inside this module is the specific
 * failure it is written to avoid.
 *
 * PRECONDITION on `faces`: every hole ring lies INSIDE its outer ring. `contours.js buildFaces`
 * guarantees this — it attaches a hole only to a ring that contains it, and drops a ring with no
 * container — so nothing here re-checks it. Probed 2026-08-15: a hand-built face whose hole sits
 * entirely outside its outer ring does still mesh, connected and finite, but stitches the stray
 * ring on through 24 nearest-neighbour fallbacks with spring rest lengths ~80x the cell size. That
 * is a phantom appendage tugging the body from empty space, and it would read as a physics fault.
 * It is left unguarded because the pipeline cannot produce it; if `softmesh.js` ever gains a caller
 * that builds faces by hand, this is the invariant that caller must uphold.
 *
 * There is deliberately no triangulation. earcut cannot introduce interior points, so a filled
 * region triangulated from its boundary alone has no interior nodes and hinges instead of resisting
 * squash. Placing the nodes on a grid means adjacency is arithmetic rather than geometry.
 */

(function (GR) {
  'use strict';

  // The longer axis never exceeds this many cells. Measured: a rigid lattice sags from SOLVER error
  // rather than from its springs past this span, and that sag looks exactly like softness while
  // being controlled by nothing the user can see. At 12 cells and 24/8 iterations a rigid lattice
  // holds to 0.105 sim units and is scale-invariant; at 13 it doubles. The run raises iterations to
  // 24/8 whenever a softbody exists, which is what earns 12 rather than 8.
  var MAX_CELLS = 12;

  // A cell below this solves against linearSlop (0.005) and jitters. Same floor, same reason, as
  // MIN_LINK_SIM in rope.js.
  var MIN_CELL_SIM = 0.12;

  // Cells across the shape's own WALL, which the bounding box cannot see. Without this a 200pt "O"
  // with a 20pt wall is sized from its 200pt box, admits no interior node at all, and silently
  // becomes an outline-only mesh that behaves like a rope.
  var MIN_WALL_CELLS = 2;

  // How far an interior point must clear every ring, as a fraction of a cell. This is what makes
  // ATTACH_RADIUS the right reach.
  var INTERIOR_CLEAR = 0.5;

  // How far a boundary node reaches for interior nodes to spring to, as a fraction of a cell.
  var ATTACH_RADIUS = 1.5;

  // Boundary nodes are inset by this fraction of a cell, because the collision silhouette is the
  // union of the node circles rather than the drawn curve.
  var INSET_FRAC = 0.6;

  // How many springs join a face to the faces before it.
  //
  // ONE is a hinge: a dot hung on a single spring swings about it like a pendulum, which is not what
  // an "i" does. THREE is the smallest count that pins position and resists rotation at once, and
  // the pairs are chosen with DISTINCT endpoints so the three cannot all meet at one node and
  // collapse back into that same hinge.
  var CROSS_FACE_LINKS = 3;

  // How far apart the anchors of those three springs must be, in cells, measured on BOTH faces.
  var CROSS_FACE_SPREAD = 2;

  /** Absolute area of one closed ring, by the shoelace formula. */
  function ringArea(ring) {
    var a = 0;
    for (var i = 0, n = ring.length; i < n; i += 2) {
      var j = (i + 2) % n;
      a += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
    }
    return Math.abs(a) / 2;
  }

  /** Closed length of one ring. */
  function ringPerimeter(ring) {
    var p = 0;
    for (var i = 0, n = ring.length; i < n; i += 2) {
      var j = (i + 2) % n;
      var dx = ring[j] - ring[i], dy = ring[j + 1] - ring[i + 1];
      p += Math.sqrt(dx * dx + dy * dy);
    }
    return p;
  }

  /** Hole-subtracted area of a face. */
  function faceArea(face) {
    var a = ringArea(face.outer);
    var holes = face.holes || [];
    for (var i = 0; i < holes.length; i++) a -= ringArea(holes[i]);
    return Math.max(0, a);
  }

  /** Perimeter of a face INCLUDING its hole rings — the annulus identity needs both. */
  function facePerimeter(face) {
    var p = ringPerimeter(face.outer);
    var holes = face.holes || [];
    for (var i = 0; i < holes.length; i++) p += ringPerimeter(holes[i]);
    return p;
  }

  /**
   * Mean wall width, as `2 * area / perimeter`.
   *
   * For an annulus this returns the wall exactly, which is the identity the thickness limit rests
   * on. It costs one pass over rings that are already in hand, where a true medial axis would not.
   */
  function faceThickness(face) {
    var p = facePerimeter(face);
    return p > 0 ? 2 * faceArea(face) / p : 0;
  }

  /** Bounding box of every outer ring in a list of faces. */
  function facesBBox(faces) {
    var lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (var f = 0; f < faces.length; f++) {
      var r = faces[f].outer;
      for (var i = 0; i < r.length; i += 2) {
        if (r[i] < lo[0]) lo[0] = r[i];
        if (r[i] > hi[0]) hi[0] = r[i];
        if (r[i + 1] < lo[1]) lo[1] = r[i + 1];
        if (r[i + 1] > hi[1]) hi[1] = r[i + 1];
      }
    }
    return { minX: lo[0], minY: lo[1], maxX: hi[0], maxY: hi[1] };
  }

  /**
   * The cell size for a whole object, or a reason it cannot be jelly.
   *
   * Two limits, and the smaller wins, because the bounding box and the shape are not the same
   * thing. `byThickness` takes the MINIMUM over faces so that a two-face "i" cannot size its cells
   * from the stem and leave the dot with no interior nodes.
   *
   * Returns `{ cell, cellsAcross, limit, fallback }`. `fallback` is null when the object can be
   * meshed; otherwise it is 'extent' (too intricate for its size) or 'thin' (below the cell floor),
   * and the report says which.
   */
  function softCellSize(faces, opts) {
    var o = opts || {};
    var maxCells = o.maxCells === undefined ? MAX_CELLS : o.maxCells;
    var minCell = o.minCell === undefined ? MIN_CELL_SIM : o.minCell;
    var wallCells = o.wallCells === undefined ? MIN_WALL_CELLS : o.wallCells;

    if (!faces || !faces.length) return { cell: null, cellsAcross: 0, limit: null, fallback: 'thin' };

    var bb = facesBBox(faces);
    var maxDim = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    if (!(maxDim > 0)) return { cell: null, cellsAcross: 0, limit: null, fallback: 'thin' };

    var byExtent = maxDim / maxCells;

    var thinnest = Infinity;
    for (var f = 0; f < faces.length; f++) {
      var t = faceThickness(faces[f]);
      if (t > 0 && t < thinnest) thinnest = t;
    }
    if (!isFinite(thinnest)) return { cell: null, cellsAcross: 0, limit: null, fallback: 'thin' };
    var byThickness = thinnest / wallCells;

    var limit = byThickness < byExtent ? 'thickness' : 'extent';
    var cell = Math.min(byExtent, byThickness);

    // The floor is not a clamp that rescues a shape: if the wall cannot hold MIN_WALL_CELLS at a
    // cell size the solver can work with, the shape is not jelly and says so.
    if (cell < minCell) {
      if (thinnest / minCell < wallCells) return { cell: null, cellsAcross: 0, limit: limit, fallback: 'thin' };
      cell = minCell;
    }

    var cellsAcross = Math.ceil(maxDim / cell - 1e-9);
    if (cellsAcross > maxCells) return { cell: null, cellsAcross: cellsAcross, limit: limit, fallback: 'extent' };

    return { cell: cell, cellsAcross: cellsAcross, limit: limit, fallback: null };
  }

  /** Crossing-number test against one closed ring. */
  function pointInRing(x, y, ring) {
    var inside = false;
    for (var i = 0, n = ring.length; i < n; i += 2) {
      var j = (i + 2) % n;
      var xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
      if ((yi > y) !== (yj > y)) {
        var t = (y - yi) / (yj - yi);
        if (x < xi + t * (xj - xi)) inside = !inside;
      }
    }
    return inside;
  }

  /** Inside the outer ring and outside every hole. */
  function pointInFace(x, y, face) {
    if (!pointInRing(x, y, face.outer)) return false;
    var holes = face.holes || [];
    for (var i = 0; i < holes.length; i++) if (pointInRing(x, y, holes[i])) return false;
    return true;
  }

  /**
   * Distance from a point to the nearest segment of ANY ring of the face, holes included.
   *
   * Holes count because a point deep inside the material but hugging a counter is not clear of the
   * geometry — an interior node placed there sits on top of the hole's boundary nodes, and a spring
   * of near-zero length is exactly what the solver cannot resolve.
   */
  function distanceToRings(x, y, face) {
    var best = Infinity;
    var rings = [face.outer].concat(face.holes || []);
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0, n = ring.length; i < n; i += 2) {
        var j = (i + 2) % n;
        var ax = ring[i], ay = ring[i + 1], bx = ring[j], by = ring[j + 1];
        var dx = bx - ax, dy = by - ay;
        var len2 = dx * dx + dy * dy;
        var t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        var px = ax + t * dx - x, py = ay + t * dy - y;
        var d = Math.sqrt(px * px + py * py);
        if (d < best) best = d;
      }
    }
    return best;
  }

  /**
   * Resamples a CLOSED ring to `perimeter/step` points spaced evenly by ARC LENGTH.
   *
   * Walks a single cursor along the ring and places a point every `target` of arc length, carrying
   * the remainder ACROSS segment boundaries. The obvious version — measure each segment, place a
   * point when the segment is long enough, reset on advance — silently collapses when every segment
   * is shorter than the spacing: it places nothing at all. That is not an edge case, it is the
   * normal one, because `flatten.js` emits curves at FLATTEN_TOL 0.1 and a flattened circle has
   * segments far shorter than a cell. Measured on the broken version: a 128-segment circle of
   * perimeter 9.42 resampled at 0.25 returned ONE point instead of 38.
   *
   * It is also invisible to every mesh assertion — an annulus came out with 2 boundary nodes, one
   * connected component and no orphan nodes, so the tests passed on a mesh with no boundary at all.
   * Uneven spacing is the reason to care: uneven nodes carry uneven mass and spring stiffness, the
   * same defect uneven rope links had.
   */
  function resampleRing(ring, step) {
    var per = ringPerimeter(ring);
    if (!(per > 0) || !(step > 0)) return ring.slice();
    var count = Math.max(3, Math.round(per / step));
    var target = per / count;
    var out = [];
    var n = ring.length;
    var acc = 0;      // arc length at the start of the current segment
    var next = 0;     // arc length at which the next point falls
    for (var i = 0; i < n && out.length / 2 < count; i += 2) {
      var j = (i + 2) % n;
      var ax = ring[i], ay = ring[i + 1];
      var dx = ring[j] - ax, dy = ring[j + 1] - ay;
      var segLen = Math.sqrt(dx * dx + dy * dy);
      if (segLen <= 0) continue;
      while (next <= acc + segLen + 1e-12 && out.length / 2 < count) {
        var t = (next - acc) / segLen;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        out.push(ax + dx * t, ay + dy * t);
        next += target;
      }
      acc += segLen;
    }
    return out;
  }

  /**
   * Offsets a boundary point into the material by `dist`.
   *
   * The direction is the ANGLE BISECTOR of the two adjacent edge normals, not one segment's normal.
   * At a corner a single segment normal slides the point along the neighbouring edge instead of
   * into the material, so it lands ON the outline with zero clearance — measured on a 3x3 square at
   * 0.5 cells, two of its 24 boundary nodes came out uninset, which is exactly the bulge the inset
   * exists to prevent.
   *
   * The result is then VERIFIED with the inside test and flipped if it was wrong. Ring winding is
   * not trusted: rings arrive from several sources, and a silently outward inset would put the
   * collision hull outside the artwork.
   */
  function insetPoint(px, py, nx, ny, dist, face) {
    var ax = px + nx * dist, ay = py + ny * dist;
    if (pointInFace(ax, ay, face)) return [ax, ay];
    var bx = px - nx * dist, by = py - ny * dist;
    if (pointInFace(bx, by, face)) return [bx, by];
    return [px, py];
  }

  /** Unit inward bisector at point `i` of a resampled closed ring. */
  function bisectorAt(pts, i) {
    var n = pts.length;
    var prev = (i - 2 + n) % n, next = (i + 2) % n;
    var d1x = pts[i] - pts[prev], d1y = pts[i + 1] - pts[prev + 1];
    var d2x = pts[next] - pts[i], d2y = pts[next + 1] - pts[i + 1];
    var l1 = Math.sqrt(d1x * d1x + d1y * d1y) || 1;
    var l2 = Math.sqrt(d2x * d2x + d2y * d2y) || 1;
    var nx = -d1y / l1 + -d2y / l2;
    var ny = d1x / l1 + d2x / l2;
    var l = Math.sqrt(nx * nx + ny * ny);
    if (l < 1e-12) return [-d2y / l2, d2x / l2];   // a straight-through point
    return [nx / l, ny / l];
  }

  /**
   * Nodes and springs for one object.
   *
   * Boundary nodes are emitted FIRST, so indices `0 .. boundaryCount-1` are the ones whose motion
   * the drawn outline follows most closely, and interior nodes follow.
   *
   * `faceOf` maps every node — boundary and interior alike — back to the face it came from. Nothing
   * inside a face needs it, because both the grid keys and the ring spans are already per-face; it
   * exists so `addSoftSprings` can find the faces and JOIN them, which is the one step that has to
   * reason across the boundary between two of them.
   */
  function buildSoftMesh(faces, opts) {
    var o = opts || {};
    var cell = o.cell;
    var inset = (o.insetFrac === undefined ? INSET_FRAC : o.insetFrac) * cell;
    var clear = (o.interiorClear === undefined ? INTERIOR_CLEAR : o.interiorClear) * cell;

    var boundary = [];      // flat x,y
    var boundaryFace = [];  // face index per boundary node
    var ringSpans = [];     // { start, count } per ring, for the ring springs
    var interior = [];      // flat x,y
    var interiorFace = [];  // face index per interior node
    var grid = {};          // "face:col,row" -> interior node index, for arithmetic adjacency

    for (var f = 0; f < faces.length; f++) {
      var face = faces[f];
      var rings = [face.outer].concat(face.holes || []);

      for (var r = 0; r < rings.length; r++) {
        var pts = resampleRing(rings[r], cell);
        var start = boundary.length / 2;
        var placed = 0;
        for (var i = 0; i < pts.length; i += 2) {
          var bis = bisectorAt(pts, i);
          var p = insetPoint(pts[i], pts[i + 1], bis[0], bis[1], inset, face);
          boundary.push(p[0], p[1]);
          boundaryFace.push(f);
          placed++;
        }
        ringSpans.push({ start: start, count: placed });
      }

      var bb = facesBBox([face]);
      var cols = Math.ceil((bb.maxX - bb.minX) / cell);
      var rows = Math.ceil((bb.maxY - bb.minY) / cell);
      for (var c = 0; c <= cols; c++) {
        for (var w = 0; w <= rows; w++) {
          var gx = bb.minX + c * cell, gy = bb.minY + w * cell;
          if (!pointInFace(gx, gy, face)) continue;
          if (distanceToRings(gx, gy, face) < clear) continue;
          grid[f + ':' + c + ',' + w] = interior.length / 2;
          interior.push(gx, gy);
          interiorFace.push(f);
        }
      }
    }

    var nodes = boundary.concat(interior);
    return {
      nodes: nodes,
      boundaryCount: boundary.length / 2,
      interiorCount: interior.length / 2,
      // Concatenated in the same order the coordinates are, so `faceOf[n]` indexes `nodes[n*2]`.
      faceOf: boundaryFace.concat(interiorFace),
      faceCount: faces.length,
      ringSpans: ringSpans,
      grid: grid,
      cell: cell,
      springs: []
    };
  }

  /** Squared distance between two node indices. */
  function nodeDist2(nodes, a, b) {
    var dx = nodes[a * 2] - nodes[b * 2], dy = nodes[a * 2 + 1] - nodes[b * 2 + 1];
    return dx * dx + dy * dy;
  }

  /**
   * The `want` closest node pairs between face `face` and every face BEFORE it, SPREAD APART.
   *
   * Greedy over the shortest pairs, refusing any candidate whose endpoints sit within `spread` of an
   * endpoint already chosen, on EITHER side. Merely requiring distinct node indices was tried first
   * and is not enough: the three globally shortest pairs are three ways of joining the same
   * neighbourhood, and they came out anchored on three consecutive boundary nodes of one face. That
   * is a hinge with extra steps. Measured on the two-disc fixture with every spring made perfectly
   * rigid, so that the only thing under test is the join: consecutive anchors settled at 0.979
   * against a rest separation of 1.800 — the faces still ended up on top of each other — and spread
   * anchors settled at 1.797.
   *
   * `spread` halves each time no full set can be found, and the last pass asks for none at all, so a
   * face too small to offer three separated nodes is still joined rather than left loose.
   *
   * Pair count is |face| x |earlier faces|, and MAX_CELLS bounds a mesh to a few hundred nodes, so
   * the quadratic scan is cheaper than any structure that would avoid it.
   */
  function crossFacePairs(nodes, faceOf, face, want, cell) {
    var mine = [], theirs = [];
    for (var i = 0; i < faceOf.length; i++) {
      if (faceOf[i] === face) mine.push(i);
      else if (faceOf[i] < face) theirs.push(i);
    }
    var pairs = [];
    for (var a = 0; a < mine.length; a++) {
      var ax = nodes[mine[a] * 2], ay = nodes[mine[a] * 2 + 1];
      for (var b = 0; b < theirs.length; b++) {
        var dx = nodes[theirs[b] * 2] - ax, dy = nodes[theirs[b] * 2 + 1] - ay;
        pairs.push([dx * dx + dy * dy, mine[a], theirs[b]]);
      }
    }
    pairs.sort(function (p, q) { return p[0] - q[0]; });

    var best = [];
    var spread = CROSS_FACE_SPREAD * (cell || 0);
    for (var pass = 0; ; pass++) {
      var min2 = spread * spread;
      var takenA = [], takenB = [], out = [];
      for (var k = 0; k < pairs.length && out.length < want; k++) {
        var na = pairs[k][1], nb = pairs[k][2], ok = true;
        for (var t = 0; t < takenA.length; t++) {
          if (na === takenA[t] || nb === takenB[t] ||
              nodeDist2(nodes, na, takenA[t]) < min2 || nodeDist2(nodes, nb, takenB[t]) < min2) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        takenA.push(na);
        takenB.push(nb);
        out.push([na, nb]);
      }
      if (out.length > best.length) best = out;
      if (best.length >= want || spread === 0) break;
      spread /= 2;
      if (spread < 1e-6) spread = 0;
    }
    return best;
  }

  /**
   * Springs: grid adjacency for the interior, ring order for the boundary, and a radius search to
   * join the two.
   *
   * Interior adjacency is arithmetic — right, up, and BOTH diagonals. The diagonals are not
   * optional: a grid without them is a mechanism rather than a structure and shears flat under its
   * own weight. Boundary nodes are not on the grid, so their attachment is the one genuinely
   * geometric step here, and the one a connectivity test has to guard.
   *
   * A multi-face object is then STITCHED into one structure. `buildFaces` returns two faces for an
   * "i", and also for "!", "%", ":" and quote marks, and neither of the two things that could hold
   * them together happens on its own: the grid keys are per-face so no lattice spring ever crosses,
   * and every face shares one negative `filterGroupIndex`, which means the faces cannot even collide
   * with each other. Measured on two 120pt discs stacked 300pt overall (54 nodes at 12 cells): they
   * start 1.800 sim units apart and after 15s of falling the gap is 0.018 — the dot lands INSIDE the
   * stem. The rigid path never had this problem because it puts every face's parts on ONE body; the
   * cross-face springs are how the soft path says the same thing.
   */
  function addSoftSprings(mesh, opts) {
    var o = opts || {};
    var cell = mesh.cell;
    var reach = (o.attachRadius === undefined ? ATTACH_RADIUS : o.attachRadius) * cell;
    var nodes = mesh.nodes;
    var bCount = mesh.boundaryCount;
    var springs = [];
    var seen = {};

    function add(a, b) {
      if (a === b) return;
      var key = (a < b ? a : b) + '-' + (a < b ? b : a);
      if (seen[key]) return;
      seen[key] = 1;
      var dx = nodes[a * 2] - nodes[b * 2], dy = nodes[a * 2 + 1] - nodes[b * 2 + 1];
      springs.push([a, b, Math.sqrt(dx * dx + dy * dy)]);
    }

    // Interior lattice, by arithmetic.
    for (var key in mesh.grid) {
      if (!Object.prototype.hasOwnProperty.call(mesh.grid, key)) continue;
      var parts = key.split(':');
      var fi = parts[0];
      var cr = parts[1].split(',');
      var c = parseInt(cr[0], 10), w = parseInt(cr[1], 10);
      var self = mesh.grid[key] + bCount;
      var neighbours = [[c + 1, w], [c, w + 1], [c + 1, w + 1], [c - 1, w + 1]];
      for (var n = 0; n < neighbours.length; n++) {
        var nk = fi + ':' + neighbours[n][0] + ',' + neighbours[n][1];
        if (mesh.grid[nk] === undefined) continue;
        add(self, mesh.grid[nk] + bCount);
      }
    }

    // Boundary rings, in order and closed.
    for (var r = 0; r < mesh.ringSpans.length; r++) {
      var span = mesh.ringSpans[r];
      for (var i = 0; i < span.count; i++) {
        add(span.start + i, span.start + ((i + 1) % span.count));
      }
    }

    // Boundary to interior, by radius.
    var fallbacks = 0;
    for (var b = 0; b < bCount; b++) {
      var bx = nodes[b * 2], by = nodes[b * 2 + 1];
      var nearest = -1, nearestD = Infinity, within = 0;
      for (var k = 0; k < mesh.interiorCount; k++) {
        var idx = bCount + k;
        var ddx = nodes[idx * 2] - bx, ddy = nodes[idx * 2 + 1] - by;
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d <= reach) { add(b, idx); within++; }
        if (d < nearestD) { nearestD = d; nearest = idx; }
      }
      // A node with nothing in range still attaches to its nearest interior neighbour, so the mesh
      // is never disconnected. But that safety net makes an "every boundary node is attached" test
      // TAUTOLOGICAL - it can never fail while any interior node exists. So the fallback is
      // COUNTED, and the count is what the test asserts: it says ATTACH_RADIUS was actually wide
      // enough, which is the property the radius exists to provide.
      if (!within && nearest >= 0) { add(b, nearest); fallbacks++; }
    }
    mesh.attachFallbacks = fallbacks;

    // Face to face. Rest length is whatever the two nodes are ALREADY apart, which `add` measures,
    // so the faces hold the separation they were drawn with rather than being pulled together.
    var links = o.crossFaceLinks === undefined ? CROSS_FACE_LINKS : o.crossFaceLinks;
    var faceOf = mesh.faceOf || [];
    var faceCount = 0;
    for (var q = 0; q < faceOf.length; q++) if (faceOf[q] + 1 > faceCount) faceCount = faceOf[q] + 1;
    var crossFaceSprings = 0;
    for (var fc = 1; fc < faceCount; fc++) {
      var pairs = crossFacePairs(nodes, faceOf, fc, links, cell);
      for (var p = 0; p < pairs.length; p++) {
        add(pairs[p][0], pairs[p][1]);
        crossFaceSprings++;
      }
    }
    mesh.crossFaceSprings = crossFaceSprings;

    mesh.springs = springs;
    return mesh;
  }

  // How much of a ring repair may discard before it is refused, as a fraction of what it KEEPS.
  //
  // Measured against the RETAINED area and not the original ring's, and that is the subtle part: a
  // folded ring's |shoelace| already has the fold subtracted, because the lobe is traversed with
  // opposite orientation. So an original-area denominator collapses toward zero exactly as the fold
  // grows - an equal-lobe figure-eight has |shoelace| of exactly 0 - which is precisely when the
  // valve has to decide.
  //
  // 0.25 sits two orders of magnitude above real artwork, which repairs at 0.01% to 2% of area, and
  // below the shapes that must be refused: a pentagram loses 44.7% in a single pass.
  var REPAIR_MAX_LOSS = 0.25;

  // Below this share of the shape a removed loop is a HAIRLINE, not a fold.
  //
  // A hairline is a sub-pixel tangle rather than folded artwork. `evalSoftOutline` blends each
  // outline point over its OWN set of nodes, so two adjacent points bound to different sets get
  // slightly different rotations; at the density a flattened curve actually has, that shows up as a
  // hairpin. Reproduced headlessly on the ten-shape rig: at 64 points a ring there are none, at
  // 1600 one appears, and it costs exactly one point and zero area.
  //
  // 0.01% of a 100x100pt shape is 1pt^2 - a loop that small cannot be seen at any zoom, which is
  // the property the threshold is really testing for. It changes nothing about what repair DOES; it
  // only decides which sentence the report prints.
  //
  // The count this was originally justified by - "797 loops removed, worst 0.00%" from a real run -
  // was NOT hairlines. It was an all-NaN outline, from the `frameIndex` defect fixed in sim.js and
  // the negated range test fixed in `properCross`. The distinction below is still right; the number
  // that motivated it was measuring nothing.
  var REPAIR_HAIRLINE = 0.0001;

  /** Signed shoelace area. The SIGN carries the winding, so repair can prove it preserved it. */
  function ringSignedArea(p) {
    var a = 0;
    for (var i = 0; i < p.length; i += 2) {
      var j = (i + 2) % p.length;
      a += p[i] * p[j + 1] - p[j] * p[i + 1];
    }
    return a / 2;
  }

  /**
   * Signed area and perimeter of each ring's NODE loop, in ringSpans order: faces in input order,
   * each face's outer ring then its holes.
   *
   * `positions` is a flat x,y array in the same order as `mesh.nodes`, so the rest pose is
   * `mesh.nodes` itself and a settled pose is the node body positions read back.
   *
   * Boundary nodes are inset by INSET_FRAC, so an outer ring's loop encloses LESS than the drawn
   * shape and a hole's loop encloses MORE than the hole. That does not matter: rest and current
   * are measured identically and only their ratio is ever used.
   *
   * The SIGN is the input ring's winding, carried straight through: buildSoftMesh does not
   * normalise it, so a hole reports whichever way it was drawn. Callers reference each ring's
   * OWN rest sign rather than an absolute convention - see `softPressurePass` (softbody.js).
   */
  function ringAreas(mesh, positions) {
    var out = [];
    for (var r = 0; r < mesh.ringSpans.length; r++) {
      var span = mesh.ringSpans[r];
      var ring = [];
      for (var i = 0; i < span.count; i++) {
        var n = span.start + i;
        ring.push(positions[n * 2], positions[n * 2 + 1]);
      }
      out.push({ area: ringSignedArea(ring), perimeter: ringPerimeter(ring) });
    }
    return out;
  }

  /**
   * Where two segments PROPERLY cross, or null.
   *
   * Strictly interior on both, and a zero determinant rejected, so touching endpoints and collinear
   * overlap do not count. Deliberately stricter than `outlineFolds`, which counts a collinear pair
   * because its `side()` returns 0 and 0 is neither +1 nor -1: a sheared square is an affine map of
   * a simple ring and cannot self-intersect, yet `outlineFolds` reports a fold on it and this
   * reports nothing.
   */
  function properCross(ax, ay, bx, by, cx, cy, dx, dy) {
    var rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    var den = rx * sy - ry * sx;
    if (den === 0) return null;
    var t = ((cx - ax) * sy - (cy - ay) * sx) / den;
    var u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    // Written as a positive test rather than the negation of one, and that is not a style choice.
    // With a NaN coordinate anywhere in the ring every `<=` and `>=` is false, so the negated form
    // falls straight through and reports a proper crossing at EVERY pair of segments. Measured:
    // that turned an all-NaN outline into "797 loops removed, worst 0.00%" in the console report,
    // a number that described nothing at all. The positive form fails closed.
    if (!(t > 0 && t < 1 && u > 0 && u < 1)) return null;
    return [ax + t * rx, ay + t * ry];
  }

  /** Every proper self-crossing of a closed ring, or just the first when `firstOnly`. */
  function scanCrossings(pts, firstOnly) {
    var n = pts.length / 2, count = 0;
    for (var i = 0; i < n; i++) {
      var i2 = (i + 1) % n;
      for (var j = i + 1; j < n; j++) {
        var j2 = (j + 1) % n;
        if (j === i || j2 === i || i2 === j) continue;
        var X = properCross(pts[i * 2], pts[i * 2 + 1], pts[i2 * 2], pts[i2 * 2 + 1],
                            pts[j * 2], pts[j * 2 + 1], pts[j2 * 2], pts[j2 * 2 + 1]);
        if (!X) continue;
        if (firstOnly) return { i: i, j: j, X: X };
        count++;
      }
    }
    return firstOnly ? null : count;
  }

  /** How many proper self-crossings does this closed ring have? */
  function ringCrossings(pts) { return scanCrossings(pts, false); }

  /** Drops any point identical to the one after it, including across the wrap. */
  function dedupeRing(p) {
    var out = [];
    for (var i = 0; i < p.length; i += 2) {
      var j = (i + 2) % p.length;
      if (p[i] === p[j] && p[i + 1] === p[j + 1]) continue;
      out.push(p[i], p[i + 1]);
    }
    return out;
  }

  /**
   * Removes self-intersection loops from a closed ring.
   *
   * A closed curve that crosses itself fills with a HOLE under even-odd, so a folded jelly comes
   * back as gouged artwork. Self-collision cannot prevent that, and the reason is structural: the
   * drawn outline sits INSET_FRAC = 0.6 cell OUTSIDE the node ring while self-contact begins at
   * 0.5 cell of node separation, so two arms resting against each other legally have already
   * overlapped 0.7 cell on paper. Repairing the curve is the last defence, and unlike the physics it
   * is guaranteed - per ring - because it operates on exactly the geometry that gets written.
   *
   * A crossing splits a closed ring into exactly two closed loops, both through the crossing point.
   * Keep the larger: a fold is the smaller lobe by construction, so nothing has to guess which.
   *
   * That holds because a real fold is a SHORT CONTIGUOUS EXCURSION - an arm pokes in and comes back
   * out, so its two crossings sit close together in ring order and the loop between them is small.
   * A bowtie, whose crossings are far apart, is halved by a split at either one; measured, a
   * 25-area bowtie collapses to a 12.86 triangle. The valve below is what makes that safe.
   *
   * Termination is proven rather than hoped for. Both loops have at least 3 points and together
   * n + 2, so the kept loop is at most n - 1 and every pass strictly shrinks the ring, bounding the
   * count at n - 3. And every segment of a kept loop is a SUB-SEGMENT of an original, so a pass can
   * never create a crossing that was not already there - oscillation is impossible.
   *
   * Returns the ORIGINAL points whenever it will not or need not act, so a caller can always use
   * `.points` unconditionally.
   */
  function repairRing(points, opts) {
    var o = opts || {};
    var maxLoss = o.maxLoss === undefined ? REPAIR_MAX_LOSS : o.maxLoss;
    var hairline = o.hairline === undefined ? REPAIR_HAIRLINE : o.hairline;
    var pts = points.slice();
    var maxPasses = o.maxPasses === undefined ? points.length / 2 : o.maxPasses;
    var removed = 0, lost = 0, passes = 0;
    // Every discarded lobe's area, kept so the loops can be split into hairlines and real folds
    // once the retained area is known. Classifying inside the loop would have to measure against
    // the ring as it stands mid-repair, which is not the shape anyone will look at.
    var loopAreas = [];

    // Reports what it WOULD have discarded. A refusal with no number leaves the user unable to
    // judge it, and "would have removed 49% of this shape" is the useful part.
    function abandon(why, frac) {
      return { points: points, loopsRemoved: 0, lostArea: lost, lossFraction: frac || 0,
               hairlineLoops: 0, foldLoops: 0, worstLoopFraction: 0,
               repaired: false, abandoned: why };
    }

    for (;;) {
      if (pts.length / 2 < 3) return abandon('degenerate');
      var f = scanCrossings(pts, true);
      if (!f) break;
      if (passes >= maxPasses) return abandon('passes');
      passes++;

      var n = pts.length / 2, A = [f.X[0], f.X[1]], B = [f.X[0], f.X[1]], k;
      for (k = f.i + 1; k <= f.j; k++) A.push(pts[(k % n) * 2], pts[(k % n) * 2 + 1]);
      for (k = f.j + 1; k <= f.i + n; k++) B.push(pts[(k % n) * 2], pts[(k % n) * 2 + 1]);

      var aA = Math.abs(ringSignedArea(A)), aB = Math.abs(ringSignedArea(B));
      var dropped = aA >= aB ? aB : aA;
      if (aA >= aB) pts = A; else pts = B;
      lost += dropped;
      loopAreas.push(dropped);
      removed++;
      pts = dedupeRing(pts);
    }

    if (!removed) {
      return { points: points, loopsRemoved: 0, lostArea: 0, lossFraction: 0,
               hairlineLoops: 0, foldLoops: 0, worstLoopFraction: 0,
               repaired: false, abandoned: null };
    }
    if (pts.length / 2 < 3) return abandon('degenerate');

    var kept = Math.abs(ringSignedArea(pts));
    if (kept <= 0) return abandon('zeroArea', Infinity);
    var frac = lost / kept;
    if (frac > maxLoss) return abandon('loss', frac);

    // Against the RETAINED area, exactly as the valve is - see above for why the original ring's
    // |shoelace| is the wrong denominator.
    var hairlines = 0, worstLoop = 0;
    for (var la = 0; la < loopAreas.length; la++) {
      var lf = loopAreas[la] / kept;
      if (lf <= hairline) hairlines++;
      if (lf > worstLoop) worstLoop = lf;
    }

    return { points: pts, loopsRemoved: removed, lostArea: lost, lossFraction: frac,
             hairlineLoops: hairlines, foldLoops: removed - hairlines,
             worstLoopFraction: worstLoop,
             repaired: true, abandoned: null };
  }

  /**
   * Boundary pairs that must be jointed before self-contact fixtures can exist.
   *
   * A softbody's nodes never collided with each other, so nothing stopped one arm entering another
   * and a crescent folded straight through itself. Giving boundary nodes a small collision fixture
   * fixes that, but only if no pair STARTS inside the contact distance — a pair that does is pushed
   * apart on the first step and the shape inflates itself apart.
   *
   * Every such pair is therefore given a spring, which removes the contact through the
   * `collideConnected: false` that every joint in this rig already carries. That makes a frame-0
   * explosion impossible BY CONSTRUCTION rather than by margin: afterwards, every remaining
   * unjointed pair is outside the contact distance by definition.
   *
   * There is deliberately NO ring-separation threshold, and this is the part that is easy to get
   * wrong. Bracing only `i,i+2` looks sufficient, because that is the only separation that occurs
   * across a sample of ten real shapes — but the convergence band comes from `insetPoint` pushing
   * both sides INSET_FRAC into the material, so its width scales as 1/sin(half-angle). Measured on
   * teardrops: separation 3 at a 39 degree tip, 4 at 33 degrees — where the two-apart pair sits
   * OUTSIDE the contact distance and an `|i-j| <= 2` rule fires nothing at all.
   *
   * A brace can never span a GAP, only material: the inset moves both nodes away from empty space,
   * so across a gap the separation is at least 2 * INSET_FRAC = 1.2 cells, never inside a contact
   * distance this rig uses. Measured on a "C" at eight apertures down to 0.015 rad, a mouth almost
   * shut: no brace spans the mouth in any of them, so a "C" cannot be welded into an "O".
   *
   * `contactFrac` is the contact DISTANCE as a fraction of a cell, not the fixture radius.
   */
  function softBraces(mesh, contactFrac) {
    var contact = contactFrac * mesh.cell;
    var nodes = mesh.nodes, bCount = mesh.boundaryCount;

    var jointed = {};
    for (var s = 0; s < mesh.springs.length; s++) {
      var a = mesh.springs[s][0], b = mesh.springs[s][1];
      jointed[(a < b ? a : b) + '-' + (a < b ? b : a)] = 1;
    }

    // How far apart along their ring, so the report can say how wide a brace reached. Cross-ring
    // and cross-face pairs share no ring and report -1.
    function arcSeparation(p, q) {
      for (var r = 0; r < mesh.ringSpans.length; r++) {
        var span = mesh.ringSpans[r];
        if (p >= span.start && p < span.start + span.count &&
            q >= span.start && q < span.start + span.count) {
          var raw = Math.abs(p - q);
          return Math.min(raw, span.count - raw);
        }
      }
      return -1;
    }

    var pairs = [], maxArc = 0;
    // Every boundary node against every other, across rings and across faces alike. Scoping this
    // per ring would leave a cross-ring pair in contact at rest and the guarantee would be gone.
    for (var p = 0; p < bCount; p++) {
      for (var q = p + 1; q < bCount; q++) {
        if (jointed[p + '-' + q]) continue;
        var dx = nodes[p * 2] - nodes[q * 2], dy = nodes[p * 2 + 1] - nodes[q * 2 + 1];
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d >= contact) continue;
        pairs.push([p, q, d]);
        var arc = arcSeparation(p, q);
        if (arc > maxArc) maxArc = arc;
      }
    }
    return { pairs: pairs, maxArc: maxArc };
  }

  /** Number of connected components over the spring graph. One, or the mesh is not a mesh. */
  function softMeshComponents(mesh) {
    var count = mesh.nodes.length / 2;
    if (!count) return 0;
    var adj = [];
    for (var i = 0; i < count; i++) adj.push([]);
    for (var s = 0; s < mesh.springs.length; s++) {
      adj[mesh.springs[s][0]].push(mesh.springs[s][1]);
      adj[mesh.springs[s][1]].push(mesh.springs[s][0]);
    }
    var seen = new Array(count), components = 0;
    for (var n = 0; n < count; n++) {
      if (seen[n]) continue;
      components++;
      var stack = [n];
      seen[n] = true;
      while (stack.length) {
        var cur = stack.pop();
        for (var a = 0; a < adj[cur].length; a++) {
          if (!seen[adj[cur][a]]) { seen[adj[cur][a]] = true; stack.push(adj[cur][a]); }
        }
      }
    }
    return components;
  }

  // How many mesh nodes each outline point follows. Four is enough to be smooth and few enough to
  // stay cheap; the weights fall off fast, so more adds little.
  var BIND_K = 4;

  /**
   * Binds a drawn outline to the mesh, once, at rest.
   *
   * Weighted skinning rather than barycentric coordinates, for robustness: barycentric needs a
   * containing triangle, and a triangle that INVERTS under jelly deformation turns its bound points
   * inside out, while a thin feature may fall outside the mesh entirely and have no triangle at
   * all. Weighted binding has neither failure and simply gets smoother as the mesh gets sparser.
   */
  function bindOutline(points, mesh, opts) {
    var o = opts || {};
    var k = o.k === undefined ? BIND_K : o.k;
    var eps = o.eps === undefined ? 1e-12 : o.eps;
    var nodes = mesh.nodes;
    var count = nodes.length / 2;
    var out = [];

    for (var p = 0; p < points.length; p += 2) {
      var px = points[p], py = points[p + 1];
      var best = [];
      for (var n = 0; n < count; n++) {
        var dx = nodes[n * 2] - px, dy = nodes[n * 2 + 1] - py;
        best.push([dx * dx + dy * dy, n]);
      }
      best.sort(function (a, b) { return a[0] - b[0]; });
      var take = Math.min(k, best.length);

      var idx = [], w = [], ox = [], oy = [], sum = 0;
      for (var i = 0; i < take; i++) {
        var node = best[i][1];
        // The epsilon matters: an outline point can land exactly on a mesh node.
        var weight = 1 / (best[i][0] + eps);
        idx.push(node);
        w.push(weight);
        ox.push(px - nodes[node * 2]);
        oy.push(py - nodes[node * 2 + 1]);
        sum += weight;
      }
      for (var j = 0; j < w.length; j++) w[j] /= sum;
      out.push({ idx: idx, w: w, ox: ox, oy: oy });
    }
    return out;
  }

  /**
   * Per-node best-fit rotation, from rest neighbours against current ones.
   *
   * In 2D this is one atan2 over a sum of cross and dot products — no matrix decomposition. Without
   * it, a jelly that ROTATES has its outline shrink toward the mesh centroid, because averaging
   * several rotated positions cuts the corner. That is the classic candy-wrapper collapse.
   */
  function nodeRotations(mesh, positions) {
    var count = mesh.nodes.length / 2;
    // Keyed on the spring count so a re-sprung mesh cannot silently reuse stale adjacency.
    if (!mesh._adj || mesh._adjFor !== mesh.springs.length) {
      var adj = [];
      for (var a = 0; a < count; a++) adj.push([]);
      for (var s = 0; s < mesh.springs.length; s++) {
        adj[mesh.springs[s][0]].push(mesh.springs[s][1]);
        adj[mesh.springs[s][1]].push(mesh.springs[s][0]);
      }
      mesh._adj = adj;
      mesh._adjFor = mesh.springs.length;
    }
    var rest = mesh.nodes, adjacency = mesh._adj;
    var out = new Array(count);
    for (var n = 0; n < count; n++) {
      var cross = 0, dot = 0;
      var list = adjacency[n];
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        var rx = rest[m * 2] - rest[n * 2], ry = rest[m * 2 + 1] - rest[n * 2 + 1];
        var nx = positions[m * 2] - positions[n * 2], ny = positions[m * 2 + 1] - positions[n * 2 + 1];
        cross += rx * ny - ry * nx;
        dot += rx * nx + ry * ny;
      }
      out[n] = (cross === 0 && dot === 0) ? 0 : Math.atan2(cross, dot);
    }
    return out;
  }

  /** Rebuilds the drawn outline from current node positions. */
  function evalSoftOutline(binding, mesh, positions) {
    var rot = nodeRotations(mesh, positions);
    var out = [];
    for (var b = 0; b < binding.length; b++) {
      var bind = binding[b];
      var x = 0, y = 0;
      for (var i = 0; i < bind.idx.length; i++) {
        var n = bind.idx[i];
        var th = rot[n], c = Math.cos(th), s = Math.sin(th);
        var lx = bind.ox[i] * c - bind.oy[i] * s;
        var ly = bind.ox[i] * s + bind.oy[i] * c;
        x += bind.w[i] * (positions[n * 2] + lx);
        y += bind.w[i] * (positions[n * 2 + 1] + ly);
      }
      out.push(x, y);
    }
    return out;
  }

  /**
   * Does this closed outline cross itself? Returns the number of crossing segment pairs.
   *
   * A self-intersecting outline is not a cosmetic problem: a closed curve that crosses itself fills
   * with a HOLE where the winding cancels, so the artwork comes back with white gouges in it. That
   * is the visible symptom of the lattice having been crushed — a mass-spring mesh has no area
   * preservation, so under a heavy enough pile the cells collapse and the skinned outline folds
   * through itself. Measured on a real 10-shape scene: clean at 30Hz, gouged at 15.5Hz.
   *
   * Adjacent segments share an endpoint and are skipped. This is O(n^2) and is therefore run ONCE,
   * on the settled frame, for the report — never per frame during playback.
   */
  function outlineFolds(pts, limit) {
    var n = pts.length / 2;
    var cap = limit === undefined ? 64 : limit;
    var found = 0;
    if (n < 4) return 0;
    for (var i = 0; i < n; i++) {
      var ax = pts[i * 2], ay = pts[i * 2 + 1];
      var bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
      for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        var cx = pts[j * 2], cy = pts[j * 2 + 1];
        var dx = pts[((j + 1) % n) * 2], dy = pts[((j + 1) % n) * 2 + 1];
        if (side(ax, ay, bx, by, cx, cy) !== side(ax, ay, bx, by, dx, dy) &&
            side(cx, cy, dx, dy, ax, ay) !== side(cx, cy, dx, dy, bx, by)) {
          found++;
          if (found >= cap) return found;
        }
      }
    }
    return found;
  }

  /** Which side of the line pq does r fall on? 0 means collinear within tolerance. */
  function side(px, py, qx, qy, rx, ry) {
    var v = (qy - py) * (rx - qx) - (qx - px) * (ry - qy);
    return v > 1e-12 ? 1 : (v < -1e-12 ? -1 : 0);
  }

  GR.ringArea = ringArea;
  GR.ringPerimeter = ringPerimeter;
  GR.faceArea = faceArea;
  GR.facePerimeter = facePerimeter;
  GR.faceThickness = faceThickness;
  GR.facesBBox = facesBBox;
  GR.softCellSize = softCellSize;
  GR.outlineFolds = outlineFolds;
  GR.pointInFace = pointInFace;
  GR.distanceToRings = distanceToRings;
  GR.resampleRing = resampleRing;
  GR.buildSoftMesh = buildSoftMesh;
  GR.addSoftSprings = addSoftSprings;
  GR.softBraces = softBraces;
  GR.repairRing = repairRing;
  GR.ringCrossings = ringCrossings;
  GR.ringSignedArea = ringSignedArea;
  GR.ringAreas = ringAreas;
  GR.SOFT_REPAIR_MAX_LOSS = REPAIR_MAX_LOSS;
  GR.SOFT_REPAIR_HAIRLINE = REPAIR_HAIRLINE;
  GR.softMeshComponents = softMeshComponents;
  GR.bindOutline = bindOutline;
  GR.nodeRotations = nodeRotations;
  GR.evalSoftOutline = evalSoftOutline;
  GR.SOFT_MAX_CELLS = MAX_CELLS;
  GR.SOFT_MIN_CELL_SIM = MIN_CELL_SIM;
  GR.SOFT_MIN_WALL_CELLS = MIN_WALL_CELLS;
  GR.SOFT_INTERIOR_CLEAR = INTERIOR_CLEAR;
  GR.SOFT_ATTACH_RADIUS = ATTACH_RADIUS;
  GR.SOFT_INSET_FRAC = INSET_FRAC;
  GR.SOFT_CROSS_FACE_LINKS = CROSS_FACE_LINKS;
})(GR);

// -------------------------------------------------------------------------
// src/thickness.js
/**
 * thickness.js — local thickness at a point on a boundary. Pure geometry, no Affinity API.
 *
 * "Local thickness" is how far it is ACROSS the material, and it is what separates a pillow from an
 * offset: an offset moves every boundary point by a constant, so a thin arm grows as much as a fat
 * body. Scaling the displacement by thickness instead is the whole effect.
 */
(function (GR) {
  'use strict';

  // Relative: a handle counts as collapsed when it sits within this fraction of the chord length of
  // its anchor. flatten.js's LINE_EPS is module-local and ABSOLUTE; the SDK reference says a
  // straight segment stores `c1 ~= start`, not `c1 == start`, so an absolute threshold would be a
  // guess against unverified data. UNVERIFIED against real curves until Task 9 probes it.
  var LINE_EPS = 1e-6;

  // The flatten tolerance, as a fraction of the face's bounding-box diagonal. RELATIVE, not the
  // absolute 0.1 of flatten.js: tau is built from this and tau bounds the accuracy of t, so an
  // absolute tolerance makes the error scale-dependent. Measured on a slab at 0.005x, an absolute
  // tolerance gives -600%; this gives the same 1.0% at every scale.
  var TOL_FRAC = 5e-4;

  var ZERO_AREA_REL = 1e-9;

  function collapsed(cx, cy, ax, ay, chordLen) {
    var dx = cx - ax, dy = cy - ay;
    return Math.sqrt(dx * dx + dy * dy) <= LINE_EPS * chordLen;
  }

  /** B(0.5) = (A + 3c1 + 3c2 + B) / 8 — the CURVE midpoint, never the chord midpoint. */
  function midPoint(s) {
    return { x: (s.start.x + 3 * s.c1.x + 3 * s.c2.x + s.end.x) / 8,
             y: (s.start.y + 3 * s.c1.y + 3 * s.c2.y + s.end.y) / 8 };
  }

  /** B'(0.5) = (3/4)(B + c2 - c1 - A). The 3/4 is dropped: only the direction is used. */
  function midTangent(s) {
    return { x: s.end.x + s.c2.x - s.c1.x - s.start.x,
             y: s.end.y + s.c2.y - s.c1.y - s.start.y };
  }

  /**
   * (ey, -ex)/|e|, times the ring sign.
   *
   * That formula points OUT of the enclosed region of a positively-wound ring and INTO it for a
   * negatively-wound one. So with outer rings signed +1 and counters -1, one formula points away
   * from the MATERIAL everywhere: outward on an outer ring, into the void on a hole.
   */
  function normalOf(dx, dy, sign) {
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) return null;
    return { x: sign * dy / len, y: -sign * dx / len };
  }

  function faceBBoxDiagonal(face) {
    var rings = [face.outer].concat(face.holes || []);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0; i < ring.length; i += 2) {
        if (ring[i] < x0) x0 = ring[i];
        if (ring[i] > x1) x1 = ring[i];
        if (ring[i + 1] < y0) y0 = ring[i + 1];
        if (ring[i + 1] > y1) y1 = ring[i + 1];
      }
    }
    if (!isFinite(x0)) return 0;
    return Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  }

  /** The control-point hull bounds the curve, so this needs no flattening and is exact enough. */
  function hullDiagonal(curves) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var c = 0; c < curves.length; c++) {
      var segs = curves[c].segments || [];
      for (var i = 0; i < segs.length; i++) {
        var pts = [segs[i].start, segs[i].c1, segs[i].c2, segs[i].end];
        for (var p = 0; p < 4; p++) {
          if (pts[p].x < x0) x0 = pts[p].x;
          if (pts[p].x > x1) x1 = pts[p].x;
          if (pts[p].y < y0) y0 = pts[p].y;
          if (pts[p].y > y1) y1 = pts[p].y;
        }
      }
    }
    if (!isFinite(x0)) return 0;
    return Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  }

  /** The flatten tolerance for a set of curves. One pass: the hull needs no flattening to find. */
  function tolFor(curves) {
    var d = hullDiagonal(curves);
    return d > 0 ? TOL_FRAC * d : GR.FLATTEN_TOL;
  }

  /**
   * Flattens every closed curve, groups the rings into faces, and gives each curve its face and its
   * ring sign.
   *
   * The original curves are NOT rewound. Reversing them would reorder the output nodes, and node
   * order is what this feature exists to preserve, so the sign is carried alongside instead — one
   * shoelace per ring, not a test per anchor.
   *
   * buildFaces pushes the CALLER'S array references, so a face's ring is mapped back to the curve
   * that produced it BY IDENTITY. That is why enforceWinding is not used: it returns new arrays and
   * would break exactly this mapping, and it would buy nothing anyway because buildFaces classifies
   * by nesting-depth parity and never reads winding.
   */
  function classify(curves, flattenTol) {
    var tol = flattenTol === undefined ? tolFor(curves) : flattenTol;
    var recs = [], i;
    for (i = 0; i < curves.length; i++) {
      var c = curves[i];
      recs.push({ curve: c, index: i, face: null, sign: 0,
                  ring: c.isClosed ? GR.flattenSegments(c.segments, { flattenTol: tol }) : null,
                  skip: c.isClosed ? null : 'open' });
    }

    var rings = [];
    for (i = 0; i < recs.length; i++) if (recs[i].ring) rings.push(recs[i].ring);
    var faces = GR.buildFaces(rings);

    function tag(ring, face, outerSign) {
      for (var k = 0; k < recs.length; k++) {
        if (recs[k].ring === ring) {                       // identity, not value
          recs[k].face = face;
          // signedArea is taken in the SAME space the normals are computed in. Under a mirroring
          // transform base and spread windings differ, and the rule is reflection-invariant only
          // when both come from one space.
          recs[k].sign = outerSign * (GR.signedArea(ring) >= 0 ? 1 : -1);
          return;
        }
      }
    }
    for (var f = 0; f < faces.length; f++) {
      tag(faces[f].outer, faces[f], 1);
      var holes = faces[f].holes || [];
      for (var hI = 0; hI < holes.length; hI++) tag(holes[hI], faces[f], -1);
    }

    // A ring buildFaces dropped (fewer than three points), and a ring of no enclosed area, have no
    // sign and no interior to grow into. Exact zero is unlikely in floating point, so the test is
    // relative to the face's own box.
    for (i = 0; i < recs.length; i++) {
      if (recs[i].skip) continue;
      if (!recs[i].face) { recs[i].skip = 'degenerate ring'; continue; }
      var diag = faceBBoxDiagonal(recs[i].face);
      if (Math.abs(GR.signedArea(recs[i].ring)) < ZERO_AREA_REL * diag * diag) recs[i].skip = 'zero area';
    }
    return { recs: recs, faces: faces, tol: tol };
  }

  /**
   * tau is NOT slack. With tau = 0 every curved probe returns ~0: the flattened ring's chords cut
   * INSIDE the true arc, so a probe disc that is tangent to the curve still clips the polygon. The
   * deficit cannot be measured at the probe point — flatten.js subdivides at t = 0.5, so B(0.5) is
   * itself a flattening vertex and its own distance to the ring is exactly zero. 2x the tolerance
   * is the sagitta bound plus a factor of two.
   */
  function probeCtx(face, flattenTol) {
    var diag = faceBBoxDiagonal(face);
    var tol = flattenTol === undefined ? TOL_FRAC * diag : flattenTol;
    return { face: face, tau: 2 * tol + 1e-9 * diag, maxR: diag / 2, diag: diag };
  }

  /**
   * The largest r whose probe disc, centred r INSIDE the boundary at (px, py), still clears the
   * geometry by r. Because the probe point is ON the boundary, dist can never EXCEED r, so the
   * predicate is really an equality: this finds the largest disc TANGENT to the boundary here.
   *
   * The bisection is well posed with no second root: dist is 1-Lipschitz in r and |dC/dr| = 1, so
   * dist(C(r)) - r is non-increasing and the satisfying set is exactly [0, r*]. That holds on
   * concave shapes too, which is what makes bisection legitimate rather than merely convenient.
   *
   * Returns -1 when the probe escaped the material. distanceToRings is UNSIGNED, so a probe that
   * has left the shape satisfies the predicate as readily as one inside it and a flipped normal
   * would yield a plausible t in silence; pointInFace is what catches that.
   */
  function probeRadius(px, py, nx, ny, face, maxR, tau) {
    var lo = 0, hi = maxR;
    for (var it = 0; it < 60; it++) {
      var mid = (lo + hi) / 2;
      if (GR.distanceToRings(px - mid * nx, py - mid * ny, face) >= mid - tau) lo = mid; else hi = mid;
    }
    if (lo > 0 && !GR.pointInFace(px - lo * nx, py - lo * ny, face)) return -1;
    return lo;
  }

  /** t = 2r at the segment's CURVE midpoint, probed along the inward normal THERE. */
  function segmentThickness(seg, sign, ctx) {
    var M = midPoint(seg), T = midTangent(seg);
    var n = normalOf(T.x, T.y, sign);
    if (!n) n = normalOf(seg.end.x - seg.start.x, seg.end.y - seg.start.y, sign);
    if (!n) return { t: 0, r: 0, M: M, n: null };
    var r = probeRadius(M.x, M.y, n.x, n.y, ctx.face, ctx.maxR, ctx.tau);
    return { t: r < 0 ? -1 : 2 * r, r: r, M: M, n: n };
  }

  function anchorThickness(px, py, n, ctx) {
    if (!n) return { t: -1, r: -1 };
    var r = probeRadius(px, py, n.x, n.y, ctx.face, ctx.maxR, ctx.tau);
    return { t: r < 0 ? -1 : 2 * r, r: r };
  }

  GR.INFL_LINE_EPS = LINE_EPS;
  GR.INFL_TOL_FRAC = TOL_FRAC;
  GR.inflCollapsed = collapsed;
  GR.inflMidPoint = midPoint;
  GR.inflMidTangent = midTangent;
  GR.inflNormalOf = normalOf;
  GR.inflFaceBBoxDiagonal = faceBBoxDiagonal;
  GR.inflHullDiagonal = hullDiagonal;
  GR.inflTolFor = tolFor;
  GR.inflClassify = classify;
  GR.inflProbeCtx = probeCtx;
  GR.inflProbeRadius = probeRadius;
  GR.inflSegmentThickness = segmentThickness;
  GR.inflAnchorThickness = anchorThickness;

})(GR);

// -------------------------------------------------------------------------
// entry
if (typeof GR.main === 'function') GR.main();
else console.log('inflate 1.0.0-dev - geometry layer only, no entry point yet. Loaded: ' + Object.keys(GR).sort().join(', '));
