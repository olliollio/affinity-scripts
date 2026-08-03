/**
 * raster.js — an alpha mask to closed contours, by marching squares. Pure geometry.
 *
 * physicsdrop samples alpha on a 48x48 grid and takes the CONVEX HULL of the opaque points, which
 * discards every concavity and every hole: a doughnut becomes a disc, a letterform becomes a blob.
 * Marching squares instead walks the boundary between opaque and transparent cells and produces
 * real closed rings — including the rings around holes, which the rest of the pipeline already
 * knows how to classify by nesting depth.
 *
 * Nothing here touches Affinity. The caller supplies a sampler function, so this is exercised
 * headlessly against synthetic masks; `extract.js` supplies the real one from PixelReaderRGBA8.
 */

(function (GR) {
  'use strict';

  // Alpha at or above this counts as solid. 128 sits at the middle of an antialiased edge, which
  // puts the contour where the eye reads the shape's boundary.
  var ALPHA_THRESHOLD = 128;

  // A 4000px image would otherwise produce a 4000-cell-wide grid and hundreds of thousands of
  // segments. Sampling is capped and the step derived from it; Douglas-Peucker then removes the
  // staircase that sampling leaves behind.
  var MAX_CELLS = 192;

  /**
   * Traces every closed contour of a binary mask.
   *
   * `inside(cx, cy)` is asked for grid coordinates and must return truthy for solid. The returned
   * rings are in GRID coordinates: 0..cols, 0..rows, with 0.5 offsets where the boundary crosses a
   * cell edge. Mapping those to document units is the caller's job.
   *
   * Rings come back unoriented. That is deliberate — `contours.js` classifies outer versus hole by
   * containment and nesting depth, not by winding, and `sanitize.js` fixes the winding afterwards.
   * Trying to emit a consistent orientation here would add a saddle-resolution problem for no gain.
   */
  function marchingSquares(cols, rows, inside, opts) {
    var o = opts || {};
    if (cols < 2 || rows < 2) return [];

    // Edge midpoints are keyed on a doubled integer lattice so that two cells naming the same
    // point produce the same key exactly, with no floating-point comparison anywhere.
    //   N = (2x+1, 2y)   E = (2x+2, 2y+1)   S = (2x+1, 2y+2)   W = (2x, 2y+1)
    var links = new Map();

    function connect(ax, ay, bx, by) {
      var ka = ax + ',' + ay, kb = bx + ',' + by;
      var la = links.get(ka);
      if (!la) { la = []; links.set(ka, la); }
      var lb = links.get(kb);
      if (!lb) { lb = []; links.set(kb, lb); }
      la.push(kb);
      lb.push(ka);
    }

    for (var y = 0; y < rows - 1; y++) {
      for (var x = 0; x < cols - 1; x++) {
        var tl = inside(x, y) ? 1 : 0;
        var tr = inside(x + 1, y) ? 2 : 0;
        var br = inside(x + 1, y + 1) ? 4 : 0;
        var bl = inside(x, y + 1) ? 8 : 0;
        var code = tl | tr | br | bl;
        if (code === 0 || code === 15) continue;

        var N = [2 * x + 1, 2 * y];
        var E = [2 * x + 2, 2 * y + 1];
        var S = [2 * x + 1, 2 * y + 2];
        var W = [2 * x, 2 * y + 1];

        switch (code) {
          case 1: case 14: connect(W[0], W[1], N[0], N[1]); break;
          case 2: case 13: connect(N[0], N[1], E[0], E[1]); break;
          case 3: case 12: connect(W[0], W[1], E[0], E[1]); break;
          case 4: case 11: connect(E[0], E[1], S[0], S[1]); break;
          case 6: case 9:  connect(N[0], N[1], S[0], S[1]); break;
          case 7: case 8:  connect(W[0], W[1], S[0], S[1]); break;
          // Saddles. Both diagonal corners are solid and both anti-diagonal ones are not, so the
          // boundary could be drawn two ways. Either is geometrically valid; what matters is being
          // CONSISTENT, because an inconsistent choice leaves a vertex with three links and the
          // loop walk below can no longer be unambiguous.
          case 5:
            connect(W[0], W[1], N[0], N[1]);
            connect(E[0], E[1], S[0], S[1]);
            break;
          case 10:
            connect(N[0], N[1], E[0], E[1]);
            connect(W[0], W[1], S[0], S[1]);
            break;
        }
      }
    }

    // Every point now has exactly two neighbours, so following one without immediately turning
    // back traces a closed loop.
    var visited = new Set();
    var rings = [];

    links.forEach(function (_neighbours, startKey) {
      if (visited.has(startKey)) return;

      var ring = [];
      var current = startKey;
      var previous = null;
      var guard = 0;
      var limit = links.size * 2 + 8;

      while (current && !visited.has(current) && guard++ < limit) {
        visited.add(current);
        var parts = current.split(',');
        ring.push(Number(parts[0]) / 2, Number(parts[1]) / 2);

        var neighbours = links.get(current);
        var next = null;
        for (var i = 0; i < neighbours.length; i++) {
          if (neighbours[i] !== previous && !visited.has(neighbours[i])) { next = neighbours[i]; break; }
        }
        previous = current;
        current = next;
      }

      // Three points is the least that encloses any area.
      if (ring.length >= 6) rings.push(ring);
    });

    if (o.minRingPoints) {
      rings = rings.filter(function (r) { return r.length / 2 >= o.minRingPoints; });
    }
    return rings;
  }

  /**
   * Sampling step for an image, so a large one does not produce an unusable grid.
   *
   * Returns 1 for anything already small enough. The staircase that sampling introduces is
   * correlated along each run, which is exactly the error Douglas-Peucker removes almost entirely.
   */
  function sampleStep(width, height, maxCells) {
    var cap = maxCells || MAX_CELLS;
    var longest = Math.max(width, height);
    return longest <= cap ? 1 : Math.ceil(longest / cap);
  }

  /**
   * Contours of an alpha mask, in the image's own PIXEL coordinates.
   *
   * `readAlpha(px, py)` returns 0..255 for a pixel. The mask is sampled on a step derived from the
   * image size, traced, and the grid coordinates scaled back to pixels.
   *
   * A one-cell transparent border is asserted around the sampled grid: without it, a shape running
   * to the edge of its own image produces an open boundary, and an open ring cannot enclose area.
   */
  function alphaContours(width, height, readAlpha, opts) {
    var o = opts || {};
    if (!(width > 0) || !(height > 0)) return [];

    var threshold = o.alphaThreshold === undefined ? ALPHA_THRESHOLD : o.alphaThreshold;
    var step = o.step || sampleStep(width, height, o.maxCells);

    var cols = Math.floor((width - 1) / step) + 3;   // +2 for the transparent border
    var rows = Math.floor((height - 1) / step) + 3;

    function inside(cx, cy) {
      if (cx <= 0 || cy <= 0 || cx >= cols - 1 || cy >= rows - 1) return false;
      var px = Math.min(width - 1, (cx - 1) * step);
      var py = Math.min(height - 1, (cy - 1) * step);
      var a = readAlpha(px, py);
      return (typeof a === 'number' ? a : 0) >= threshold;
    }

    var rings = marchingSquares(cols, rows, inside, o);

    // Grid space back to pixel space. The -1 undoes the border, and the 0.5 offsets that marching
    // squares produces survive the multiply, which is what keeps the contour on the real edge.
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      for (var k = 0; k < r.length; k += 2) {
        r[k] = (r[k] - 1) * step;
        r[k + 1] = (r[k + 1] - 1) * step;
      }
    }
    return rings;
  }

  GR.marchingSquares = marchingSquares;
  GR.alphaContours = alphaContours;
  GR.rasterSampleStep = sampleStep;
  GR.ALPHA_THRESHOLD = ALPHA_THRESHOLD;

})(GR);
