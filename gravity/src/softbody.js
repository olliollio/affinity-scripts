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

  // Softness in Hz. Below about 2 the sheet stretches absurdly rather than reading as soft; above
  // 30 it is indistinguishable from rigid and starts fighting the timestep.
  var MIN_FREQ = 2;
  var MAX_FREQ = 30;
  var DAMPING_RATIO = 0.4;

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
        frequency: 0, springCount: 0, totalMass: 0, fallback: reason,
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
    var freq = o.frequencyHz === undefined ? softnessToFrequency(o.softness) : o.frequencyHz;

    var nodes = [];
    for (var n = 0; n < nodeCount; n++) {
      var body = W.world.createDynamicBody({
        position: new pl.Vec2(mesh.nodes[n * 2], mesh.nodes[n * 2 + 1]),
        linearDamping: o.linearDamping === undefined ? NODE_LINEAR_DAMPING : o.linearDamping
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
        isSoftNode: true
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
})(GR);
