/**
 * softbody.js — the only softbody module that touches planck.
 *
 * planck has no soft bodies and never will: it is a Box2D 2.x port, and b2ParticleSystem belongs to
 * LiquidFun, a separate fork. So a softbody is a RIG — many ordinary dynamic bodies wired together
 * with DistanceJoint springs so that they behave as one deformable thing. rope.js does the same in
 * one dimension.
 *
 * The pure half lives in softmesh.js and is tested headlessly. addSoftBody is the impure boundary.
 */

(function (GR) {
  'use strict';

  // Node circles overlap so the union has no gap for a corner to pass through.
  var RADIUS_FRAC = 0.6;

  // Softness in Hz. Above 30 a spring is indistinguishable from rigid and starts fighting the
  // timestep, so that is the stiff end.
  //
  // The soft end is 8, not 2. Settled height as a fraction of rest height, no drop, 30s at 24/8:
  //
  //     freqHz     blob      bold "O"
  //         30    0.980        0.831
  //         28    0.976        0.801
  //         26    0.970        0.756
  //         24    0.966        0.495
  //         22    0.961        0.227
  //         20    0.953        0.210
  //         16    0.932        0.184
  //         12    0.883        0.147
  //          8    0.755        0.120
  //          6    0.452        0.115
  //          4    0.131        0.110
  //          2    0.086        0.075
  //
  // A solid blob degrades smoothly down to 8 and then collapses. Nothing below 8 holds its shape at
  // all, so the old 30..2 range spent half the slider on settings that were never usable — and the
  // old default of 0.5 landed on 7.7Hz, which flattens a ring to 12% of its height before it has
  // even landed.
  var MIN_FREQ = 8;
  var MAX_FREQ = 30;
  var DAMPING_RATIO = 0.4;

  // The floor for a shape with a hole in it, however soft the user asked for.
  //
  // Read the "O" column above: a ring holds from 30 to 26 and then falls off a cliff, losing half
  // its height between 26 and 22. It BUCKLES. A mass-spring lattice has no area preservation, so
  // nothing at all resists the hole ovalising once the wall starts to fold, and the collapse is
  // structural rather than a tuning failure — the known fix is a pressure or volume-preservation
  // term, which this rig does not have. Until it does, the softness setting is a REQUEST that the
  // shape's own structure can override, the same idiom rope slack already uses when measured
  // clearance clamps the slack that was asked for.
  //
  // The floor is 28 rather than 26, and the two extra Hz are the whole point. Buckling is a
  // BIFURCATION, so values inside the cliff are not properties of the shape at all. Measured by
  // perturbing only the flattening resolution of one identical 300pt ring — same geometry, more
  // segments:
  //
  //     freqHz   n=96    n=112   n=128   n=160   spread
  //         30   0.829   0.832   0.831   0.840   0.011
  //         28   0.799   0.797   0.801   0.812   0.015
  //         26   0.218   0.758   0.756   0.763   0.545   <- coin flip
  //         24   0.191   0.279   0.495   0.551   0.360
  //          8   0.117   0.121   0.120   0.120   0.004
  //
  // At 26 the same "O" either squashes to 0.76 or collapses to 0.22 depending on how finely its
  // curves happened to flatten, which the user has no control over and cannot see. That also
  // explains why two independent measurements of this table disagreed mid-cliff and agreed at both
  // ends: neither was wrong, the region simply does not reproduce. 28 sits where the spread is
  // 0.015 and the answer is a property of the shape again.
  var SHELL_MIN_FREQ = 28;

  // A large soft structure has a very long tail of small motion, and a run ends only when EVERY
  // body is quiet at once. Same lever, same reason, as the rope link damping.
  var NODE_LINEAR_DAMPING = 0.5;

  // Counts DOWN from -1, one per softbody. Negative means "never collide within this group", so a
  // shape does not inflate itself apart on its own overlapping circles; distinct values mean two
  // jellies still collide with each other normally.
  var nextGroup = -1;

  /** Softness 0..1 to frequency, log-spaced because droop is strongly non-linear in Hz. */
  function softnessToFrequency(softness) {
    var t = Math.max(0, Math.min(1, softness === undefined ? 0.5 : softness));
    return Math.exp(Math.log(MAX_FREQ) + t * (Math.log(MIN_FREQ) - Math.log(MAX_FREQ)));
  }

  /** One ring from SOURCE units to SIM units. The y flip is the same mirror `toSim` applies. */
  function convertRing(ring, scale) {
    var out = [];
    for (var i = 0; i < ring.length; i += 2) out.push(ring[i] / scale, -ring[i + 1] / scale);
    return out;
  }

  /**
   * Meshes an object's faces and builds the rig.
   *
   * `faces` arrive in SOURCE units and are converted here, once, because softmesh.js works entirely
   * in sim units. Returns a record with `fallback` set when the object cannot be jelly, saying why,
   * so the caller can build a rigid body instead and report it.
   */
  function addSoftBody(W, faces, opts) {
    var o = opts || {};
    var pl = W.planck;
    var scale = W.scale;
    var name = o.name || 'soft';

    // Source y grows downward and sim y grows upward. Converting here keeps the mirror in one
    // place, exactly as toSim does for everything else.
    var simFaces = [];
    for (var f = 0; f < faces.length; f++) {
      var face = faces[f];
      var holes = [];
      var srcHoles = face.holes || [];
      for (var hi = 0; hi < srcHoles.length; hi++) holes.push(convertRing(srcHoles[hi], scale));
      simFaces.push({ outer: convertRing(face.outer, scale), holes: holes });
    }

    function give(reason, limit) {
      return {
        nodes: [], mesh: null, groupIndex: 0, cell: null, cellsAcross: 0, limit: limit || null,
        frequency: 0, frequencyRequested: 0, frequencyFloored: null,
        springCount: 0, totalMass: 0, fallback: reason,
        node: o.node || null, name: name
      };
    }

    var sized = GR.softCellSize(simFaces);
    if (sized.fallback) return give(sized.fallback, sized.limit);

    var mesh = GR.buildSoftMesh(simFaces, { cell: sized.cell });
    GR.addSoftSprings(mesh);
    var nodeCount = mesh.nodes.length / 2;
    if (!nodeCount) return give('thin', sized.limit);

    var radius = RADIUS_FRAC * sized.cell;

    // Mass is solved backwards from the target, because overlapping circles double-count area
    // badly. The target is whatever the RIGID body would have weighed, which means honouring
    // Equalise mass exactly as bodies.js does — it overrides density so every rigid body lands on
    // targetMass regardless of area, and a jelly that ignored that becomes the one heavy object in
    // the scene.
    var simArea = 0;
    for (var a = 0; a < simFaces.length; a++) simArea += GR.faceArea(simFaces[a]);
    var density = o.density === undefined ? 1 : o.density;
    var targetMass = o.targetMass === undefined ? 1 : o.targetMass;
    var totalMass = o.equaliseMass ? targetMass : simArea * density;
    var perNode = totalMass / nodeCount;
    // Degenerate masses would otherwise give planck an infinite or zero density and it rejects
    // every fixture on the body. Same guard, same reason, as addBody's density clamp.
    var nodeDensity = Math.min(1e6, Math.max(1e-6, perNode / (Math.PI * radius * radius)));

    var groupIndex = nextGroup--;
    // `frequencyHz` overrides the softness mapping outright, and 0 means a RIGID constraint rather
    // than a very stiff spring. Rigid is not a position on the user's slider — the spec is explicit
    // that rigid means not naming the object — but the tests need it, because "does the solver hold
    // this span" is a question about the solver and must not be asked through a spring.
    var requested = o.frequencyHz === undefined ? softnessToFrequency(o.softness) : o.frequencyHz;
    var freq = requested;
    var floored = null;

    // The shell floor applies to the SETTING only. An explicit `frequencyHz` is a caller taking
    // control of the solver, and flooring it would silently turn a test's rigid constraint into a
    // 26Hz spring — the one thing that would make every stiffness measurement meaningless.
    if (o.frequencyHz === undefined) {
      var hasHoles = false;
      for (var hf = 0; hf < simFaces.length; hf++) {
        if (simFaces[hf].holes.length) hasHoles = true;
      }
      var shellFloor = o.shellMinFrequency === undefined ? SHELL_MIN_FREQ : o.shellMinFrequency;
      if (hasHoles && freq < shellFloor) {
        freq = shellFloor;
        floored = 'shell';
      }
    }

    var nodes = [];
    for (var n = 0; n < nodeCount; n++) {
      var body = W.world.createDynamicBody({
        position: new pl.Vec2(mesh.nodes[n * 2], mesh.nodes[n * 2 + 1]),
        linearDamping: o.linearDamping === undefined ? NODE_LINEAR_DAMPING : o.linearDamping,
        // A node's own SPIN is not part of the model and is never drawn: the outline follows node
        // POSITIONS, and evalSoftOutline derives each node's orientation from where its neighbours
        // ended up rather than from the body's angle. Left free, that spurious degree of freedom
        // does real damage - the circles roll against each other and the walls and never stop, so
        // no island can ever sleep and every run burns the full frame cap. Measured on a real
        // 717-body scene: linear motion had fallen to 0.152 pt/s, comfortably UNDER the 0.504
        // threshold, while spin sat at 51.76 rad/s against a 0.0349 tolerance - 1500x over, and the
        // sole reason 717 of 717 bodies were still awake. Measured on a 609-body headless pile,
        // fixing rotation takes peak spin from 0.4398 to 0.0023 rad/s and the awake count from 507
        // to 302. It also removes a rotational constraint per node from the solver.
        fixedRotation: true
      });
      body.createFixture(new pl.Circle(radius), {
        density: nodeDensity,
        friction: o.friction === undefined ? 0.4 : o.friction,
        restitution: o.restitution === undefined ? 0 : o.restitution,
        filterGroupIndex: groupIndex
      });
      var rec = {
        body: body,
        // The rest position back in SRC units, so playback places this node exactly as it places a
        // rigid body or a rope link.
        ox: mesh.nodes[n * 2] * scale,
        oy: -mesh.nodes[n * 2 + 1] * scale,
        angle0: 0,
        simRadius: radius,
        fixtures: 1,
        rejected: [],
        bullet: false,
        name: name + ' [' + n + ']',
        node: o.node || null,
        isSoftNode: true,
        // Which softbody this node belongs to. seedJitter draws once per group, so a lattice is
        // nudged as one object rather than shaken node by node.
        softGroup: groupIndex
      };
      W.dynamics.push(rec);
      nodes.push(rec);
    }

    // Springs at the body CENTRES: the rest length softmesh solved is a centre-to-centre distance,
    // so both local anchors are the body origin and nothing has to be re-measured here.
    for (var s = 0; s < mesh.springs.length; s++) {
      var sp = mesh.springs[s];
      W.world.createJoint(new pl.DistanceJoint({
        bodyA: nodes[sp[0]].body,
        bodyB: nodes[sp[1]].body,
        localAnchorA: new pl.Vec2(0, 0),
        localAnchorB: new pl.Vec2(0, 0),
        length: sp[2],
        frequencyHz: freq,
        dampingRatio: o.dampingRatio === undefined ? DAMPING_RATIO : o.dampingRatio,
        collideConnected: false
      }));
    }

    return {
      nodes: nodes,
      mesh: mesh,
      groupIndex: groupIndex,
      cell: sized.cell,
      cellsAcross: sized.cellsAcross,
      limit: sized.limit,
      frequency: freq,
      // What the softness setting asked for, and why it did not get it. The report prints both,
      // because a user who asked for goo and got a firm shell has to be able to see that.
      frequencyRequested: requested,
      frequencyFloored: floored,
      springCount: mesh.springs.length,
      totalMass: totalMass,
      fallback: null,
      node: o.node || null,
      name: name
    };
  }

  GR.addSoftBody = addSoftBody;
  GR.softnessToFrequency = softnessToFrequency;
  GR.SOFT_RADIUS_FRAC = RADIUS_FRAC;
  GR.SOFT_MIN_FREQ = MIN_FREQ;
  GR.SOFT_MAX_FREQ = MAX_FREQ;
  GR.SOFT_SHELL_MIN_FREQ = SHELL_MIN_FREQ;
})(GR);
