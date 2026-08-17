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

  // Below this share of the shape a removed loop is a HAIRLINE, not a fold. Measured in Affinity on
  // the ten-shape scene: 797 loops removed across ten outlines and not one of them reached 0.005%,
  // because they are sub-pixel tangles from the outline resampling rather than folded artwork - the
  // whole scene stayed visually clean, and the report printed "worst 0.00%" to two decimals, so
  // every one of them was under 0.005%. 0.01% of a 100x100pt shape is 1pt^2 - a loop that small
  // cannot be seen at any zoom, which is the property the threshold is really testing for. It
  // changes nothing about what repair DOES; it only decides which sentence the report prints.
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
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
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
