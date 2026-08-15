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
   */
  function buildSoftMesh(faces, opts) {
    var o = opts || {};
    var cell = o.cell;
    var inset = (o.insetFrac === undefined ? INSET_FRAC : o.insetFrac) * cell;
    var clear = (o.interiorClear === undefined ? INTERIOR_CLEAR : o.interiorClear) * cell;

    var boundary = [];    // flat x,y
    var ringSpans = [];   // { start, count } per ring, for the ring springs
    var interior = [];    // flat x,y
    var grid = {};        // "col,row" -> interior node index, for arithmetic adjacency

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
        }
      }
    }

    var nodes = boundary.concat(interior);
    return {
      nodes: nodes,
      boundaryCount: boundary.length / 2,
      interiorCount: interior.length / 2,
      ringSpans: ringSpans,
      grid: grid,
      cell: cell,
      springs: []
    };
  }

  /**
   * Springs: grid adjacency for the interior, ring order for the boundary, and a radius search to
   * join the two.
   *
   * Interior adjacency is arithmetic — right, up, and BOTH diagonals. The diagonals are not
   * optional: a grid without them is a mechanism rather than a structure and shears flat under its
   * own weight. Boundary nodes are not on the grid, so their attachment is the one genuinely
   * geometric step here, and the one a connectivity test has to guard.
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

    mesh.springs = springs;
    return mesh;
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

  GR.ringArea = ringArea;
  GR.ringPerimeter = ringPerimeter;
  GR.faceArea = faceArea;
  GR.facePerimeter = facePerimeter;
  GR.faceThickness = faceThickness;
  GR.facesBBox = facesBBox;
  GR.softCellSize = softCellSize;
  GR.pointInFace = pointInFace;
  GR.distanceToRings = distanceToRings;
  GR.resampleRing = resampleRing;
  GR.buildSoftMesh = buildSoftMesh;
  GR.addSoftSprings = addSoftSprings;
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
})(GR);
