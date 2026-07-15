/**
 * Cartoon aerial combat scene (Three.js).
 * Player plane + near/far enemies + boss, day/dusk/night sky cycle.
 */
import * as THREE from "three";

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const SKY = {
  day: {
    top: 0x5ec8ff,
    mid: 0xa8e0ff,
    bottom: 0xe8f6ff,
    fog: 0xb8e0ff,
    fogDensity: 0.012,
    sun: 0xfff2a8,
    sunIntensity: 1.35,
    ambient: 0.85,
    hemiSky: 0x87ceeb,
    hemiGround: 0xc4e8a8,
    cloud: 0xffffff,
    starOpacity: 0,
  },
  dusk: {
    top: 0x2a1a4a,
    mid: 0xc45c2a,
    bottom: 0xf0a060,
    fog: 0xc47850,
    fogDensity: 0.014,
    sun: 0xff6b2a,
    sunIntensity: 1.1,
    ambient: 0.55,
    hemiSky: 0xff8a4a,
    hemiGround: 0x6b3a2a,
    cloud: 0xffc9a0,
    starOpacity: 0.25,
  },
  night: {
    top: 0x050816,
    mid: 0x0d1a3a,
    bottom: 0x152545,
    fog: 0x0a1228,
    fogDensity: 0.018,
    sun: 0xdde8ff,
    sunIntensity: 0.35,
    ambient: 0.28,
    hemiSky: 0x1a2744,
    hemiGround: 0x0a1520,
    cloud: 0x4a5568,
    starOpacity: 0.95,
  },
};

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.w = window.innerWidth;
    this.h = window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.w, this.h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, this.w / this.h, 0.1, 500);
    // Initial chase cam (behind player along +Z when heading=0 → forward −Z)
    this.camera.position.set(0, 4.8, 9.5);
    this.camera.lookAt(0, 1.5, -12);

    this.time = 0;
    this.shake = 0;
    this.skyMode = "day";
    this.skyBlend = 0; // 0..1 during transition
    this.skyFrom = "day";
    this.skyTo = "day";
    this.skyTransitioning = false;
    this.flightSpeed = 14;

    this.projectiles = [];
    this.enemyShots = [];
    this.particles = [];
    this.clouds = [];
    this.windLines = [];
    this.groundProps = [];
    /** @type {Array<{mesh: THREE.Object3D, vel: THREE.Vector3, spin: THREE.Vector3, smoke: number, age: number}>} */
    this.crashes = [];

    this.toonGradient = this._makeToonGradient();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this.playerHitFlash = 0;

    this._buildSky();
    this._buildLights();
    this._buildStars();
    this._buildGround();
    this._buildClouds();
    this._buildWind();
    this.player = this._makePlane({
      body: 0x38bdf8,
      wing: 0xfbbf24,
      accent: 0xef4444,
      scale: 1.15,
      isPlayer: true,
    });
    // Player stays near origin; heading rotates the flight frame
    this.playerBase = new THREE.Vector3(0, 1.45, 0);
    this.player.position.copy(this.playerBase);
    this.scene.add(this.player);

    /**
     * Absolute flight heading (rad). 0 = world -Z.
     * Does NOT reset — turns accumulate so camera & world rotate with the plane.
     */
    this.heading = 0;
    this.headingTarget = 0;
    this.turnRate = 0;
    this.playerBank = 0;
    /** Relative bearing of enemies in degrees (vs current heading). − = left, + = right */
    this.nearBearingDeg = 0;
    this.farBearingDeg = 0;

    this.nearEnemy = null;
    this.farEnemy = null;
    this.boss = null;

    this.nearDist = 14;
    this.farDist = 26;
    this.enemyNearPos = new THREE.Vector3();
    this.enemyFarPos = new THREE.Vector3();
    this.bossPos = new THREE.Vector3();
    this.camDist = 9.5;
    this.camHeight = 3.4;

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.applySky("day", true);
  }

  resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.w, this.h);
  }

  _makeToonGradient() {
    const c = document.createElement("canvas");
    c.width = 5;
    c.height = 1;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 5, 0);
    g.addColorStop(0, "#222");
    g.addColorStop(0.4, "#777");
    g.addColorStop(0.7, "#ccc");
    g.addColorStop(1, "#fff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 5, 1);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    return tex;
  }

  _toon(color, opts = {}) {
    return new THREE.MeshToonMaterial({
      color,
      gradientMap: this.toonGradient,
      ...opts,
    });
  }

  _outline(mesh, color = 0x1e293b, scale = 1.08) {
    const o = new THREE.Mesh(
      mesh.geometry,
      new THREE.MeshBasicMaterial({ color, side: THREE.BackSide })
    );
    o.scale.setScalar(scale);
    mesh.add(o);
  }

  // ── Sky ──

  _buildSky() {
    const geo = new THREE.SphereGeometry(180, 32, 24);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(SKY.day.top) },
        midColor: { value: new THREE.Color(SKY.day.mid) },
        bottomColor: { value: new THREE.Color(SKY.day.bottom) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos).y;
          float t = clamp(h * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.45, t));
          col = mix(col, topColor, smoothstep(0.4, 1.0, t));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(geo, this.skyMat);
    this.scene.add(this.skyDome);

    // Sun / moon disc
    this.celestial = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff2a8 })
    );
    this.celestial.position.set(40, 35, -60);
    this.scene.add(this.celestial);
    this.celestialGlow = new THREE.Mesh(
      new THREE.SphereGeometry(5.5, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xfff2a8,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      })
    );
    this.celestial.add(this.celestialGlow);
  }

  _buildLights() {
    this.ambient = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0x87ceeb, 0xc4e8a8, 0.7);
    this.scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xfff2a8, 1.35);
    this.sunLight.position.set(30, 40, 10);
    this.scene.add(this.sunLight);
    this.scene.fog = new THREE.FogExp2(0xb8e0ff, 0.012);
  }

  _buildStars() {
    const count = 800;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = rand(60, 160);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(rand(0.05, 1));
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 5;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 20;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 0.35,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.scene.add(this.stars);
  }

  _buildClouds() {
    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group();
      const mat = this._toon(0xffffff);
      for (let j = 0; j < 4; j++) {
        const blob = new THREE.Mesh(new THREE.SphereGeometry(rand(0.6, 1.4), 8, 8), mat);
        blob.position.set(rand(-1.5, 1.5), rand(-0.3, 0.4), rand(-0.6, 0.6));
        g.add(blob);
      }
      g.position.set(rand(-40, 40), rand(4, 16), rand(-50, 20));
      g.userData.speed = rand(4, 9);
      g.userData.baseScale = rand(0.8, 1.6);
      g.scale.setScalar(g.userData.baseScale);
      this.scene.add(g);
      this.clouds.push(g);
    }
  }

  _buildWind() {
    // Speed lines for forward flight feel
    for (let i = 0; i < 40; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -rand(1.5, 4)),
      ]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.15,
        })
      );
      line.position.set(rand(-12, 12), rand(0, 8), rand(-20, 10));
      line.userData.speed = rand(28, 48);
      this.scene.add(line);
      this.windLines.push(line);
    }
  }

  /**
   * Cartoon planet ground (visible sphere cap) + scrolling scenery belt.
   */
  _buildGround() {
    this.groundRoot = new THREE.Group();
    this.scene.add(this.groundRoot);

    // Large planet — only the upper cap is visible under the flight path
    const R = 90;
    this.planetRadius = R;
    this.planetCenter = new THREE.Vector3(0, -R - 2.2, -8);
    const planetGeo = new THREE.SphereGeometry(R, 48, 32);
    const planetMat = this._toon(0x4ade80);
    this.planet = new THREE.Mesh(planetGeo, planetMat);
    this.planet.position.copy(this.planetCenter);
    this.groundRoot.add(this.planet);

    // Scrolling prop belt only — no fixed lakes/ponds that stick under the flight path
    this.propBelt = new THREE.Group();
    this.groundRoot.add(this.propBelt);

    const kinds = ["mountain", "forest", "river", "house", "cow", "hill"];
    for (let i = 0; i < 48; i++) {
      const kind = pick(kinds);
      const prop = this._makeGroundProp(kind);
      prop.userData.kind = kind;
      // Keep water features off the dead-center path so nothing looks “stuck” under the nose
      let baseX = rand(-24, 24);
      if (kind === "river" && Math.abs(baseX) < 6) {
        baseX = (Math.random() < 0.5 ? -1 : 1) * rand(7, 18);
      }
      prop.userData.baseX = baseX;
      prop.position.set(baseX, 0, -8 - i * 7.2 + rand(-2, 2));
      this._snapPropToPlanet(prop);
      this.propBelt.add(prop);
      this.groundProps.push(prop);
    }
  }

  /**
   * Forward unit vector from absolute heading.
   * Heading 0 → world −Z. Matches plane model nose (local −Z) when yaw = heading
   * via lookAt / consistent basis (see _applyPlaneYaw).
   */
  _forwardFromHeading(h = this.heading, out = this._fwd) {
    // Must match Object3D with yaw=h and local nose −Z:
    // local (0,0,−1) → world (−sin h, 0, −cos h) under standard Ry
    // so we define forward as that direction:
    out.set(-Math.sin(h), 0, -Math.cos(h));
    return out;
  }

  /** Right unit vector (heading 0 → +X). */
  _rightFromHeading(h = this.heading, out = this._right) {
    // perpendicular to forward on XZ: (cos h, 0, −sin h) for forward (−sin h, 0, −cos h)
    out.set(Math.cos(h), 0, -Math.sin(h));
    return out;
  }

  /**
   * Orient a plane group so its local −Z (nose) points along `yaw` (absolute heading),
   * with optional pitch and roll (bank). Keeps camera / motion / model aligned.
   */
  _applyPlaneYaw(obj, yaw, pitch = 0, roll = 0) {
    obj.rotation.order = "YXZ";
    // With YXZ: yaw around Y first. For nose at local −Z, yaw = heading
    // matches _forwardFromHeading (see above).
    obj.rotation.x = pitch;
    obj.rotation.y = yaw;
    obj.rotation.z = roll;
  }

  /**
   * Place an enemy at relative `bearingDeg` and `dist` ahead of the player,
   * using absolute flight heading so turns move the whole frame.
   */
  _slotFromBearing(bearingDeg, dist, y, out = new THREE.Vector3()) {
    const abs = this.heading + THREE.MathUtils.degToRad(bearingDeg);
    this._forwardFromHeading(abs, this._tmp);
    out.set(
      this.playerBase.x + this._tmp.x * dist,
      y,
      this.playerBase.z + this._tmp.z * dist
    );
    return out;
  }

  /** Random far-plane relative bearing: ±5° … ±15° */
  _randomFarBearing() {
    const sign = Math.random() < 0.5 ? -1 : 1;
    return sign * rand(5, 15);
  }

  /** Ground height under (x,z) on the planet sphere. */
  _groundYAt(x, z) {
    const R = this.planetRadius;
    const cy = this.planetCenter.y;
    const cz = this.planetCenter.z;
    const horiz = x * x + (z - cz) * (z - cz);
    const under = R * R - horiz;
    if (under > 0) return cy + Math.sqrt(under);
    return cy + R * 0.15;
  }

  _snapPropToPlanet(prop) {
    // Approximate local "ground" height under flight path (top of sphere)
    const z = prop.position.z;
    const x = prop.position.x;
    const R = this.planetRadius;
    const cy = this.planetCenter.y;
    const cz = this.planetCenter.z;
    // sphere: (x-0)^2 + (y-cy)^2 + (z-cz)^2 = R^2
    const horiz = x * x + (z - cz) * (z - cz);
    const under = R * R - horiz;
    if (under > 0) {
      prop.position.y = cy + Math.sqrt(under);
    } else {
      prop.position.y = cy + R * 0.2;
    }
  }

  _makeGroundProp(kind) {
    const g = new THREE.Group();
    if (kind === "mountain") {
      const h = rand(2.5, 5.5);
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(rand(1.8, 3.2), h, 6),
        this._toon(pick([0x94a3b8, 0xa8b4c4, 0x78716c]))
      );
      m.position.y = h * 0.5;
      this._outline(m, 0x334155, 1.05);
      g.add(m);
      const snow = new THREE.Mesh(
        new THREE.ConeGeometry(rand(0.6, 1.1), h * 0.28, 6),
        this._toon(0xf8fafc)
      );
      snow.position.y = h * 0.78;
      g.add(snow);
    } else if (kind === "hill") {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(rand(1.4, 2.4), 10, 8),
        this._toon(pick([0x86efac, 0x4ade80, 0x22c55e]))
      );
      m.scale.y = 0.45;
      m.position.y = 0.5;
      g.add(m);
    } else if (kind === "forest") {
      for (let i = 0; i < 5; i++) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.12, 0.5, 5),
          this._toon(0xc47a3a)
        );
        trunk.position.y = 0.25;
        tree.add(trunk);
        const leaf = new THREE.Mesh(
          new THREE.ConeGeometry(0.45, 0.9, 6),
          this._toon(pick([0x22c55e, 0x16a34a, 0x4ade80]))
        );
        leaf.position.y = 0.85;
        this._outline(leaf, 0x14532d, 1.06);
        tree.add(leaf);
        tree.position.set(rand(-1.2, 1.2), 0, rand(-1.2, 1.2));
        g.add(tree);
      }
    } else if (kind === "house") {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.8, 1.0),
        this._toon(pick([0xf4a261, 0xfde68a, 0xfda4af]))
      );
      wall.position.y = 0.4;
      this._outline(wall, 0x7c3a10, 1.06);
      g.add(wall);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(1.0, 0.55, 4),
        this._toon(0xef4444)
      );
      roof.position.y = 1.05;
      roof.rotation.y = Math.PI / 4;
      this._outline(roof, 0x7f1d1d, 1.06);
      g.add(roof);
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.4, 0.06),
        this._toon(0x78350f)
      );
      door.position.set(0, 0.2, 0.52);
      g.add(door);
    } else if (kind === "cow") {
      // Simple cartoon cow: body + head + spots
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.28, 0.55, 4, 6),
        this._toon(0xfafafa)
      );
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.45;
      g.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 8, 8),
        this._toon(0xfafafa)
      );
      head.position.set(0.45, 0.55, 0);
      g.add(head);
      const spot = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 6, 6),
        this._toon(0x1e293b)
      );
      spot.position.set(-0.1, 0.55, 0.15);
      g.add(spot);
      for (const lx of [-0.2, 0.15]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.35, 5),
          this._toon(0x1e293b)
        );
        leg.position.set(lx, 0.18, 0.12);
        g.add(leg);
        const leg2 = leg.clone();
        leg2.position.z = -0.12;
        g.add(leg2);
      }
      g.rotation.y = rand(0, Math.PI * 2);
      g.scale.setScalar(rand(0.85, 1.2));
    } else if (kind === "river") {
      const water = new THREE.Mesh(
        new THREE.BoxGeometry(rand(1.5, 3), 0.08, rand(4, 8)),
        this._toon(0x38bdf8)
      );
      water.position.y = 0.05;
      water.rotation.y = rand(-0.4, 0.4);
      g.add(water);
      // banks
      for (const s of [-1, 1]) {
        const bank = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.12, 5),
          this._toon(0xa3e635)
        );
        bank.position.set(s * 1.2, 0.06, 0);
        g.add(bank);
      }
    }
    return g;
  }

  _makeRiverSegment() {
    const g = new THREE.Group();
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 10, 8, 1, false),
      this._toon(0x0ea5e9)
    );
    water.rotation.z = Math.PI / 2;
    water.scale.set(1, 0.15, 1);
    water.position.y = 0.08;
    g.add(water);
    return g;
  }

  /**
   * Cartoon fighter plane.
   */
  _makePlane({ body, wing, accent, scale = 1, isPlayer = false, isBoss = false }) {
    const root = new THREE.Group();
    const s = scale * (isBoss ? 2.4 : 1);

    // Fuselage (capsule default axis = Y → rotate to Z / flight direction)
    const fuse = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22 * s, 1.1 * s, 4, 8),
      this._toon(body)
    );
    fuse.rotation.x = Math.PI / 2;
    fuse.position.z = 0;
    this._outline(fuse, 0x1e293b, 1.08);
    root.add(fuse);

    // Nose cone
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.22 * s, 0.45 * s, 8),
      this._toon(accent)
    );
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.75 * s;
    this._outline(nose, 0x1e293b, 1.1);
    root.add(nose);

    // Cockpit
    const cock = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 * s, 10, 10),
      this._toon(0x7dd3fc, { transparent: true, opacity: 0.85 })
    );
    cock.position.set(0, 0.22 * s, -0.1 * s);
    cock.scale.set(1, 0.7, 1.2);
    root.add(cock);

    // Wings
    const wingMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.8 * s, 0.08 * s, 0.45 * s),
      this._toon(wing)
    );
    wingMesh.position.set(0, 0, 0.05 * s);
    this._outline(wingMesh, 0x1e293b, 1.06);
    root.add(wingMesh);

    // Tail wing
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.7 * s, 0.06 * s, 0.28 * s),
      this._toon(wing)
    );
    tail.position.set(0, 0.05 * s, 0.7 * s);
    root.add(tail);

    // Vertical stabilizer
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.08 * s, 0.4 * s, 0.35 * s),
      this._toon(accent)
    );
    fin.position.set(0, 0.28 * s, 0.65 * s);
    this._outline(fin, 0x1e293b, 1.08);
    root.add(fin);

    // Propeller
    const propGroup = new THREE.Group();
    propGroup.position.z = -0.95 * s;
    const hub = new THREE.Mesh(
      new THREE.SphereGeometry(0.08 * s, 8, 8),
      this._toon(0xfbbf24)
    );
    propGroup.add(hub);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.08 * s, 0.9 * s, 0.05 * s),
      this._toon(0x334155)
    );
    propGroup.add(blade);
    const blade2 = blade.clone();
    blade2.rotation.z = Math.PI / 2;
    propGroup.add(blade2);
    root.add(propGroup);
    root.userData.prop = propGroup;

    // Exhaust glow for player
    if (isPlayer) {
      const exhaust = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 * s, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0x5eead4,
          transparent: true,
          opacity: 0.7,
        })
      );
      exhaust.position.set(0, 0, 0.85 * s);
      root.add(exhaust);
      root.userData.exhaust = exhaust;
    }

    if (isBoss) {
      // Extra wing pods
      for (const sx of [-1, 1]) {
        const pod = new THREE.Mesh(
          new THREE.SphereGeometry(0.28 * s, 8, 8),
          this._toon(0xa855f7)
        );
        pod.position.set(sx * 0.9 * s, 0, 0.1 * s);
        this._outline(pod, 0x4c1d95, 1.08);
        root.add(pod);
      }
      // Crown fin
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(0.2 * s, 0.5 * s, 5),
        this._toon(0xfbbf24)
      );
      crown.position.set(0, 0.55 * s, 0.2 * s);
      root.add(crown);
    }

    // Orientation is applied every frame via _applyPlaneYaw (heading-aligned).
    // Do NOT bake a fixed 180° here — that fought absolute heading after turns.

    root.userData.isPlayer = isPlayer;
    root.userData.isBoss = isBoss;
    root.userData.bobPhase = Math.random() * Math.PI * 2;
    return root;
  }

  // ── Public API ──

  applySky(mode, instant = false) {
    if (instant) {
      this.skyMode = mode;
      this.skyTransitioning = false;
      this._setSkyColors(SKY[mode]);
      return;
    }
    this.skyFrom = this.skyMode;
    this.skyTo = mode;
    this.skyBlend = 0;
    this.skyTransitioning = true;
  }

  nextSkyMode() {
    const order = ["day", "dusk", "night"];
    const i = order.indexOf(this.skyMode);
    return order[(i + 1) % order.length];
  }

  cycleSky() {
    this.applySky(this.nextSkyMode(), false);
  }

  _setSkyColors(cfg) {
    this.skyMat.uniforms.topColor.value.setHex(cfg.top);
    this.skyMat.uniforms.midColor.value.setHex(cfg.mid);
    this.skyMat.uniforms.bottomColor.value.setHex(cfg.bottom);
    this.scene.fog.color.setHex(cfg.fog);
    this.scene.fog.density = cfg.fogDensity;
    this.ambient.intensity = cfg.ambient;
    this.hemi.color.setHex(cfg.hemiSky);
    this.hemi.groundColor.setHex(cfg.hemiGround);
    this.sunLight.color.setHex(cfg.sun);
    this.sunLight.intensity = cfg.sunIntensity;
    this.celestial.material.color.setHex(cfg.sun);
    this.celestialGlow.material.color.setHex(cfg.sun);
    this.starMat.opacity = cfg.starOpacity;
    for (const c of this.clouds) {
      c.traverse((ch) => {
        if (ch.isMesh && ch.material && ch.material.color) {
          ch.material.color.setHex(cfg.cloud);
        }
      });
    }
    // Celestial position: sun high day, low dusk, moon night
    if (this.skyMode === "day" || (!this.skyTransitioning && cfg === SKY.day)) {
      this.celestial.position.set(45, 40, -70);
    }
  }

  _lerpSky(a, b, t) {
    const ca = SKY[a];
    const cb = SKY[b];
    const mixHex = (x, y) => {
      const c1 = new THREE.Color(x);
      const c2 = new THREE.Color(y);
      return c1.lerp(c2, t);
    };
    this.skyMat.uniforms.topColor.value.copy(mixHex(ca.top, cb.top));
    this.skyMat.uniforms.midColor.value.copy(mixHex(ca.mid, cb.mid));
    this.skyMat.uniforms.bottomColor.value.copy(mixHex(ca.bottom, cb.bottom));
    this.scene.fog.color.copy(mixHex(ca.fog, cb.fog));
    this.scene.fog.density = ca.fogDensity + (cb.fogDensity - ca.fogDensity) * t;
    this.ambient.intensity = ca.ambient + (cb.ambient - ca.ambient) * t;
    this.sunLight.intensity = ca.sunIntensity + (cb.sunIntensity - ca.sunIntensity) * t;
    this.sunLight.color.copy(mixHex(ca.sun, cb.sun));
    this.celestial.material.color.copy(mixHex(ca.sun, cb.sun));
    this.starMat.opacity = ca.starOpacity + (cb.starOpacity - ca.starOpacity) * t;
    this.celestial.position.y = THREE.MathUtils.lerp(
      a === "night" ? 28 : a === "dusk" ? 18 : 40,
      b === "night" ? 28 : b === "dusk" ? 18 : 40,
      t
    );
  }

  spawnNearEnemy(bearingDeg = 0) {
    this.removeNearEnemy();
    this.nearEnemy = this._makePlane({
      body: pick([0xf87171, 0xfb923c, 0xa78bfa]),
      wing: 0xfde68a,
      accent: 0x1e293b,
      scale: 1,
    });
    this.nearBearingDeg = bearingDeg;
    this.enemyNearPos.copy(
      this._slotFromBearing(bearingDeg, this.nearDist, 2.15 + rand(0, 0.25))
    );
    this.nearEnemy.position.copy(this.enemyNearPos);
    this.scene.add(this.nearEnemy);
    return this.nearEnemy;
  }

  /**
   * Spawn far enemy at random ±5°–15° (or forced bearingDeg).
   */
  spawnFarEnemy(bearingDeg = null) {
    this.removeFarEnemy();
    this.farEnemy = this._makePlane({
      body: pick([0x34d399, 0x60a5fa, 0xf472b6]),
      wing: 0xfef08a,
      accent: 0x334155,
      scale: 0.72,
    });
    this.farBearingDeg =
      bearingDeg == null ? this._randomFarBearing() : bearingDeg;
    this.enemyFarPos.copy(
      this._slotFromBearing(this.farBearingDeg, this.farDist, 2.85 + rand(0, 0.35))
    );
    this.farEnemy.position.copy(this.enemyFarPos);
    this.farEnemy.scale.setScalar(0.85);
    this.scene.add(this.farEnemy);
    return this.farEnemy;
  }

  /**
   * Promote far → near, then spawn a new far at a new random ±5°–15°.
   * Player turns (absolute heading) toward former far's side; camera follows.
   */
  promoteFarToNear() {
    // Capture turn BEFORE swapping (far's relative bearing)
    const turnDeg = this.farBearingDeg;
    if (this.farEnemy) {
      // Old near should already be in crashes[]; clear slot if still set
      this.nearEnemy = this.farEnemy;
      this.farEnemy = null;
      this.nearEnemy.scale.setScalar(1);
    } else {
      this.spawnNearEnemy(0);
    }
    // Absolute yaw — heading accumulates; camera & world turn with the plane
    this.steerByDegrees(turnDeg);
    // Keep near at same world direction while we yaw into it:
    // nearBearing tracks remaining turn (updated each frame)
    this.nearBearingDeg = turnDeg;
    this._slotFromBearing(this.nearBearingDeg, this.nearDist, 2.15, this.enemyNearPos);
    if (this.nearEnemy) this.nearEnemy.position.copy(this.enemyNearPos);
    this.spawnFarEnemy();
  }

  /**
   * Yaw by relative degrees (positive = right). Heading accumulates.
   */
  steerByDegrees(deltaDeg) {
    this.headingTarget = this.heading + THREE.MathUtils.degToRad(deltaDeg);
  }

  /** Level out relative bearing; optional small absolute turn for boss. */
  steerTowardBearing(bearingDeg) {
    this.headingTarget = this.heading + THREE.MathUtils.degToRad(bearingDeg);
  }

  spawnBoss() {
    this.removeNearEnemy();
    this.removeFarEnemy();
    this.removeBoss();
    this.boss = this._makePlane({
      body: 0x7c3aed,
      wing: 0xfbbf24,
      accent: 0xef4444,
      scale: 1,
      isBoss: true,
    });
    this.nearBearingDeg = 0;
    this.farBearingDeg = 0;
    this._slotFromBearing(0, 18, 2.6, this.bossPos);
    this.boss.position.copy(this.bossPos);
    this.scene.add(this.boss);
    return this.boss;
  }

  removeNearEnemy() {
    if (this.nearEnemy) {
      this.scene.remove(this.nearEnemy);
      this.nearEnemy = null;
    }
  }

  removeFarEnemy() {
    if (this.farEnemy) {
      this.scene.remove(this.farEnemy);
      this.farEnemy = null;
    }
  }

  removeBoss() {
    if (this.boss) {
      this.scene.remove(this.boss);
      this.boss = null;
    }
  }

  /**
   * Project world position to screen CSS pixels.
   */
  worldToScreen(worldPos) {
    this._tmp.copy(worldPos);
    this._tmp.project(this.camera);
    return {
      x: (this._tmp.x * 0.5 + 0.5) * this.w,
      y: (-this._tmp.y * 0.5 + 0.5) * this.h,
      visible: this._tmp.z < 1,
    };
  }

  getNearLabelAnchor() {
    if (!this.nearEnemy) return null;
    this.nearEnemy.getWorldPosition(this._tmp2);
    this._tmp2.y -= 0.9;
    return this.worldToScreen(this._tmp2);
  }

  getFarLabelAnchor() {
    if (!this.farEnemy) return null;
    this.farEnemy.getWorldPosition(this._tmp2);
    this._tmp2.y -= 0.55;
    return this.worldToScreen(this._tmp2);
  }

  getBossLabelAnchor() {
    if (!this.boss) return null;
    this.boss.getWorldPosition(this._tmp2);
    this._tmp2.y -= 1.8;
    return this.worldToScreen(this._tmp2);
  }

  /**
   * Enemy fires a red laser at the player (on wrong key).
   * @param {'near' | 'boss'} from
   * @param {() => void} [onHit]
   */
  fireEnemyAtPlayer(from = "near", onHit) {
    let source = null;
    if (from === "boss" && this.boss) source = this.boss;
    else if (this.nearEnemy) source = this.nearEnemy;
    else if (this.boss) source = this.boss;
    if (!source || !this.player) return;

    source.getWorldPosition(this._tmp);
    const start = this._tmp.clone();
    start.y += 0.15;
    this.player.getWorldPosition(this._tmp2);
    const target = this._tmp2.clone();

    const color = new THREE.Color(0xff3344);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 2.4,
      })
    );
    mesh.position.copy(start);
    this.scene.add(mesh);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff6680,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      })
    );
    mesh.add(glow);

    // Beam stretch visual
    const dist = start.distanceTo(target);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.1, dist * 0.4, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff2244,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    beam.position.copy(start.clone().lerp(target, 0.15));
    beam.lookAt(target);
    beam.rotateX(Math.PI / 2);
    this.scene.add(beam);

    const speed = 38;
    const life = dist / speed;
    const velocity = target.clone().sub(start).normalize().multiplyScalar(speed);

    this.enemyShots.push({
      mesh,
      beam,
      velocity,
      life,
      age: 0,
      onHit,
      color,
    });
    this.shake = 0.08;
  }

  /**
   * Fire from player toward a screen-space target (or world target mesh).
   */
  fireAtEnemy(kind, opts = {}) {
    const combo = opts.combo ?? 0;
    const mult = opts.multiplier ?? 1;
    const intense = combo >= 2;
    const onHit = opts.onHit;

    let target;
    if (kind === "near" && this.nearEnemy) {
      this.nearEnemy.getWorldPosition(this._tmp);
      target = this._tmp.clone();
      target.y += 0.1;
    } else if (kind === "far" && this.farEnemy) {
      this.farEnemy.getWorldPosition(this._tmp);
      target = this._tmp.clone();
    } else if (kind === "boss" && this.boss) {
      this.boss.getWorldPosition(this._tmp);
      target = this._tmp.clone();
      target.y += 0.3;
    } else {
      target = new THREE.Vector3(0, 1.5, -10);
    }

    this.player.getWorldPosition(this._tmp2);
    const start = this._tmp2.clone();
    const f = this._forwardFromHeading(this.heading, new THREE.Vector3());
    start.addScaledVector(f, 0.95);
    start.y += 0.1;

    let color = new THREE.Color(0x5eead4);
    if (mult >= 3) color = new THREE.Color(0xf6e05e);
    else if (mult >= 2) color = new THREE.Color(0xf6ad55);
    else if (intense) color = new THREE.Color(0x63b3ed);

    const radius = intense ? 0.14 + Math.min(combo, 30) * 0.003 : 0.09;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 10),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intense ? 2.2 : 1.3,
      })
    );
    mesh.position.copy(start);
    this.scene.add(mesh);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 2, 8, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: intense ? 0.4 : 0.22,
        depthWrite: false,
      })
    );
    mesh.add(glow);

    const dist = start.distanceTo(target);
    const speed = intense ? 42 + Math.min(combo, 30) * 0.4 : 34;
    const life = dist / speed;
    const velocity = target.clone().sub(start).normalize().multiplyScalar(speed);

    // Optional combo label DOM (managed by main via callback positions)
    this.shake = intense ? 0.1 + Math.min(combo, 20) * 0.003 : 0.04;

    this.projectiles.push({
      mesh,
      velocity,
      life,
      age: 0,
      onHit,
      color,
      intense,
      combo,
      target: target.clone(),
    });

    return { start, target, intense, combo, mult, color };
  }

  explodeAt(worldPos, colorHex = 0x5eead4) {
    const color = new THREE.Color(colorHex);
    for (let i = 0; i < 55; i++) {
      this._spawnParticle(worldPos, {
        speed: rand(3, 14),
        life: rand(0.4, 1.0),
        size: rand(0.08, 0.22),
        color: pick([color, new THREE.Color(0xfbbf24), new THREE.Color(0xffffff), new THREE.Color(0xf472b6)]),
        gravity: -2,
      });
    }
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.2, 24),
        new THREE.MeshBasicMaterial({
          color: pick([0x5eead4, 0xfbbf24, 0xf472b6]),
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      ring.position.copy(worldPos);
      ring.lookAt(this.camera.position);
      this.scene.add(ring);
      this.particles.push({
        mesh: ring,
        velocity: new THREE.Vector3(),
        life: 0.5 + r * 0.08,
        age: 0,
        gravity: 0,
        ring: true,
        grow: 10 + r * 4,
      });
    }
    this.shake = 0.25;
  }

  /**
   * Start a crash sequence: smoke, tumble, fall to ground, then explode.
   * Returns start position. Combat slot is cleared immediately.
   */
  explodeEnemy(kind) {
    let mesh = null;
    let color = 0x5eead4;
    if (kind === "near" && this.nearEnemy) {
      mesh = this.nearEnemy;
      this.nearEnemy = null;
    } else if (kind === "far" && this.farEnemy) {
      mesh = this.farEnemy;
      this.farEnemy = null;
    } else if (kind === "boss" && this.boss) {
      mesh = this.boss;
      this.boss = null;
      color = 0xfbbf24;
    }
    if (!mesh) {
      const p = new THREE.Vector3(0, 2, -10);
      this.explodeAt(p, color);
      return p;
    }

    const pos = new THREE.Vector3();
    mesh.getWorldPosition(pos);

    // Stop propeller spin look — keep mesh, start physics crash
    const fwd = this._forwardFromHeading(this.heading, new THREE.Vector3());
    const side = this._rightFromHeading(this.heading, new THREE.Vector3());
    const vel = new THREE.Vector3(
      fwd.x * rand(2, 5) + side.x * rand(-3, 3),
      rand(1.5, 3.5),
      fwd.z * rand(2, 5) + side.z * rand(-3, 3)
    );
    // Initial upward then fall — or slight forward + down
    vel.y = rand(0.5, 2.2);

    this.crashes.push({
      mesh,
      vel,
      spin: new THREE.Vector3(rand(-3, 3), rand(-4, 4), rand(-3, 3)),
      smoke: 0,
      age: 0,
      color,
      isBoss: kind === "boss",
    });
    return pos;
  }

  _updateCrashes(dt) {
    for (let i = this.crashes.length - 1; i >= 0; i--) {
      const c = this.crashes[i];
      c.age += dt;
      // Gravity + drag
      c.vel.y -= 14 * dt;
      c.vel.x *= 1 - 0.4 * dt;
      c.vel.z *= 1 - 0.4 * dt;
      c.mesh.position.x += c.vel.x * dt;
      c.mesh.position.y += c.vel.y * dt;
      c.mesh.position.z += c.vel.z * dt;
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;

      // Continuous smoke trail
      c.smoke += dt;
      if (c.smoke > 0.04) {
        c.smoke = 0;
        this._spawnSmoke(c.mesh.position.clone(), c.isBoss ? 1.4 : 1);
      }

      const groundY = this._groundYAt(c.mesh.position.x, c.mesh.position.z) + 0.4;
      const hitGround = c.mesh.position.y <= groundY;
      const timeout = c.age > 4.5;

      if (hitGround || timeout) {
        if (hitGround) c.mesh.position.y = groundY;
        this.explodeAt(c.mesh.position.clone(), c.color);
        // Extra ground burst
        for (let k = 0; k < 12; k++) {
          this._spawnParticle(c.mesh.position.clone(), {
            speed: rand(3, 10),
            life: rand(0.4, 0.9),
            size: rand(0.1, 0.25),
            color: pick([
              new THREE.Color(0x78716c),
              new THREE.Color(0xfbbf24),
              new THREE.Color(c.color),
              new THREE.Color(0x1e293b),
            ]),
            gravity: -6,
          });
        }
        this.scene.remove(c.mesh);
        this.crashes.splice(i, 1);
      }
    }
  }

  _spawnSmoke(pos, scale = 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 * scale, 6, 6),
      new THREE.MeshBasicMaterial({
        color: pick([0x64748b, 0x475569, 0x334155, 0x94a3b8]),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    mesh.position.copy(pos);
    mesh.position.x += rand(-0.15, 0.15);
    mesh.position.y += rand(0, 0.2);
    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3(rand(-0.4, 0.4), rand(1.2, 2.8), rand(-0.4, 0.4)),
      life: rand(0.7, 1.4),
      age: 0,
      gravity: 0.4,
      ring: false,
      smoke: true,
      grow: 1.8,
    });
  }

  _spawnParticle(pos, { speed, life, size, color, gravity }) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(size, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    this.particles.push({
      mesh,
      velocity: dir.multiplyScalar(speed),
      life,
      age: 0,
      gravity: gravity ?? -3,
      ring: false,
    });
  }

  update(dt) {
    this.time += dt;

    // Sky transition
    if (this.skyTransitioning) {
      this.skyBlend = Math.min(1, this.skyBlend + dt * 0.35);
      this._lerpSky(this.skyFrom, this.skyTo, this.skyBlend);
      if (this.skyBlend >= 1) {
        this.skyMode = this.skyTo;
        this.skyTransitioning = false;
        this._setSkyColors(SKY[this.skyMode]);
      }
    }

    // ── Absolute heading turn (accumulates — does not snap back to 0) ──
    const prevHeading = this.heading;
    const turnLerp = 1 - Math.exp(-2.8 * dt);
    this.heading += (this.headingTarget - this.heading) * turnLerp;
    this.turnRate = (this.heading - prevHeading) / Math.max(dt, 1e-4);
    // While turning into a new near target, keep it fixed in world by
    // setting relative bearing = remaining yaw
    const remain = this.headingTarget - this.heading;
    if (Math.abs(remain) > 0.015 && this.nearEnemy && !this.boss) {
      this.nearBearingDeg = THREE.MathUtils.radToDeg(remain);
    } else if (Math.abs(remain) <= 0.015 && this.nearEnemy && !this.boss) {
      this.nearBearingDeg = 0;
    }
    // Mild bank into turn (too much roll reads as “flying sideways”)
    const bankTarget = THREE.MathUtils.clamp(-this.turnRate * 0.28, -0.35, 0.35);
    this.playerBank += (bankTarget - this.playerBank) * Math.min(1, 7 * dt);

    const fwd = this._forwardFromHeading(this.heading, this._fwd);
    const right = this._rightFromHeading(this.heading, this._right);

    // Player: nose (local −Z) = forward; camera uses the same basis
    if (this.player) {
      const hit = this.playerHitFlash > 0 ? rand(-0.08, 0.08) : 0;
      this.playerHitFlash = Math.max(0, this.playerHitFlash - dt);
      this.player.position.set(
        this.playerBase.x + hit * right.x,
        this.playerBase.y + Math.sin(this.time * 2.2) * 0.08,
        this.playerBase.z + hit * right.z
      );
      const pitch = -0.04 + Math.sin(this.time * 2) * 0.015;
      this._applyPlaneYaw(this.player, this.heading, pitch, this.playerBank);
      if (this.player.userData.prop) this.player.userData.prop.rotation.z += dt * 40;
      if (this.player.userData.exhaust) {
        this.player.userData.exhaust.scale.setScalar(0.8 + Math.sin(this.time * 20) * 0.25);
      }
    }

    // Chase camera: same heading as plane — behind along −forward, look along +forward
    {
      const bob = Math.sin(this.time * 1.2) * 0.05;
      // Purely behind the aircraft (no lateral bank offset that skews view)
      let cx = this.playerBase.x - fwd.x * this.camDist;
      let cy = this.playerBase.y + this.camHeight + bob;
      let cz = this.playerBase.z - fwd.z * this.camDist;
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 0.9);
        cx += rand(-this.shake, this.shake) * 2.2;
        cy += rand(-this.shake, this.shake) * 1.6;
        cz += rand(-this.shake, this.shake) * 1.2;
      }
      this.camera.position.set(cx, cy, cz);
      // Look at a point straight ahead of the player (same forward as the nose)
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(
        this.playerBase.x + fwd.x * 16,
        this.playerBase.y + 0.6,
        this.playerBase.z + fwd.z * 16
      );
    }

    // World scrolls opposite to flight direction (true forward motion)
    const scroll = this.flightSpeed * dt;
    if (this.planet) {
      // Spin planet under the flight path based on heading
      this.planet.rotation.x += fwd.z * 0.012 * this.flightSpeed * dt;
      this.planet.rotation.z -= fwd.x * 0.012 * this.flightSpeed * dt;
    }
    for (const prop of this.groundProps) {
      prop.position.x -= fwd.x * scroll;
      prop.position.z -= fwd.z * scroll;
      if (prop.userData.kind === "cow") {
        prop.position.x += right.x * Math.sin(this.time * 0.8) * 0.02;
        prop.position.z += right.z * Math.sin(this.time * 0.8) * 0.02;
      }
      this._snapPropToPlanet(prop);
      // along > 0 ahead, < 0 behind
      const along =
        (prop.position.x - this.playerBase.x) * fwd.x +
        (prop.position.z - this.playerBase.z) * fwd.z;
      if (along < -15) {
        const ahead = rand(45, 100);
        let side = rand(-24, 24);
        if (prop.userData.kind === "river" && Math.abs(side) < 6) {
          side = (Math.random() < 0.5 ? -1 : 1) * rand(7, 18);
        }
        prop.position.x = this.playerBase.x + fwd.x * ahead + right.x * side;
        prop.position.z = this.playerBase.z + fwd.z * ahead + right.z * side;
        prop.userData.baseX = side;
        this._snapPropToPlanet(prop);
      }
    }

    // Crashing wrecks
    this._updateCrashes(dt);

    // Enemy slots relative to heading
    this._slotFromBearing(
      this.nearBearingDeg,
      this.nearDist,
      2.15 + Math.sin(this.time * 1.2) * 0.08,
      this.enemyNearPos
    );
    this._slotFromBearing(
      this.farBearingDeg,
      this.farDist,
      2.85 + Math.sin(this.time * 0.9) * 0.1,
      this.enemyFarPos
    );

    for (const e of [this.nearEnemy, this.farEnemy, this.boss]) {
      if (!e) continue;
      if (e.userData.prop) e.userData.prop.rotation.z += dt * 35;
    }

    // Enemies face the player: opposite of flight heading (nose toward camera)
    const enemyYaw = this.heading + Math.PI;
    if (this.nearEnemy) {
      this.nearEnemy.position.lerp(this.enemyNearPos, 1 - Math.exp(-8 * dt));
      this.nearEnemy.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-6 * dt));
      this._applyPlaneYaw(
        this.nearEnemy,
        enemyYaw,
        0.02,
        Math.sin(this.time * 1.5) * 0.04
      );
    }
    if (this.farEnemy) {
      this.farEnemy.position.lerp(this.enemyFarPos, 1 - Math.exp(-6 * dt));
      this._applyPlaneYaw(
        this.farEnemy,
        enemyYaw,
        0.02,
        Math.sin(this.time * 1.2) * 0.03
      );
    }
    if (this.boss) {
      this._slotFromBearing(
        Math.sin(this.time * 0.6) * 8,
        18,
        2.5 + Math.sin(this.time * 1.1) * 0.35,
        this.bossPos
      );
      this.boss.position.lerp(this.bossPos, 1 - Math.exp(-5 * dt));
      this._applyPlaneYaw(
        this.boss,
        enemyYaw + Math.sin(this.time * 0.5) * 0.08,
        0,
        0
      );
    }

    // Clouds stream opposite flight direction
    for (const c of this.clouds) {
      c.position.x -= fwd.x * c.userData.speed * dt;
      c.position.z -= fwd.z * c.userData.speed * dt;
      const along =
        (c.position.x - this.playerBase.x) * fwd.x +
        (c.position.z - this.playerBase.z) * fwd.z;
      if (along < -20) {
        const ahead = rand(40, 80);
        const side = rand(-40, 40);
        c.position.set(
          this.playerBase.x + fwd.x * ahead + right.x * side,
          rand(5, 18),
          this.playerBase.z + fwd.z * ahead + right.z * side
        );
      }
    }

    // Wind lines along flight direction
    for (const line of this.windLines) {
      line.position.x -= fwd.x * line.userData.speed * dt;
      line.position.z -= fwd.z * line.userData.speed * dt;
      line.material.opacity = 0.08 + Math.random() * 0.12;
      // Align streak with forward
      line.lookAt(
        line.position.x + fwd.x,
        line.position.y,
        line.position.z + fwd.z
      );
      const along =
        (line.position.x - this.playerBase.x) * fwd.x +
        (line.position.z - this.playerBase.z) * fwd.z;
      if (along < -10) {
        const ahead = rand(8, 28);
        const side = rand(-12, 12);
        line.position.set(
          this.playerBase.x + fwd.x * ahead + right.x * side,
          rand(0.5, 7),
          this.playerBase.z + fwd.z * ahead + right.z * side
        );
      }
    }

    // Player projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.age >= p.life) {
        if (p.onHit) p.onHit();
        this._spawnParticle(p.mesh.position.clone(), {
          speed: 2,
          life: 0.25,
          size: 0.1,
          color: p.color,
          gravity: 0,
        });
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }

    // Enemy shots at player
    for (let i = this.enemyShots.length - 1; i >= 0; i--) {
      const p = this.enemyShots[i];
      p.age += dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.beam) {
        p.beam.material.opacity = Math.max(0, 0.55 * (1 - p.age / 0.2));
        if (p.age > 0.2) {
          this.scene.remove(p.beam);
          p.beam.geometry.dispose();
          p.beam.material.dispose();
          p.beam = null;
        }
      }
      if (p.age >= p.life) {
        if (p.onHit) p.onHit();
        this.playerHitFlash = 0.35;
        this.shake = 0.18;
        this._spawnParticle(p.mesh.position.clone(), {
          speed: 4,
          life: 0.35,
          size: 0.15,
          color: p.color,
          gravity: 0,
        });
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        if (p.beam) {
          this.scene.remove(p.beam);
          p.beam.geometry.dispose();
          p.beam.material.dispose();
        }
        this.enemyShots.splice(i, 1);
      }
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      const k = 1 - p.age / p.life;
      if (p.ring) {
        const s = 1 + p.age * p.grow;
        p.mesh.scale.set(s, s, s);
        p.mesh.material.opacity = 0.85 * k;
        p.mesh.lookAt(this.camera.position);
      } else if (p.smoke) {
        p.velocity.y += (p.gravity || 0) * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.material.opacity = 0.55 * k;
        const gs = 1 + p.age * (p.grow || 1.5);
        p.mesh.scale.setScalar(gs);
      } else {
        p.velocity.y += (p.gravity || 0) * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.material.opacity = k;
        p.mesh.scale.setScalar(Math.max(0.01, k));
      }
      if (p.age >= p.life) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
      }
    }

    this.stars.rotation.y += dt * 0.01;
  }

  draw() {
    this.renderer.render(this.scene, this.camera);
  }
}
