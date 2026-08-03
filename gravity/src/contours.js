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
