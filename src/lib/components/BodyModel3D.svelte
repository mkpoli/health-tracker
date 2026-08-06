<script lang="ts">
  import * as THREE from 'three';

  interface Props {
    site: string;
    circumferences?: Record<string, number>;
    height?: number;
  }

  let { site, circumferences = {}, height = 380 }: Props = $props();

  const ACCENT = 0x7c3aed;

  const DEFAULT_CIRC: Record<string, number> = {
    head: 56,
    neck: 36,
    shoulder: 108,
    bust: 90,
    underbust: 78,
    waist: 75,
    abdomen: 84,
    hip: 95,
    thigh: 54,
    calf: 36,
    ankle: 22,
    'upper-arm': 28,
    forearm: 25,
    wrist: 16,
  };

  const SITE_Y: Record<string, number> = {
    ankle: 0.16,
    calf: 0.34,
    thigh: 0.72,
    hip: 0.9,
    abdomen: 1.02,
    waist: 1.1,
    underbust: 1.22,
    bust: 1.32,
    shoulder: 1.44,
    neck: 1.51,
    head: 1.63,
    wrist: 0.99,
    forearm: 1.12,
    'upper-arm': 1.36,
  };

  const ARM_SITES = new Set(['upper-arm', 'forearm', 'wrist']);
  const LEG_SITES = new Set(['thigh', 'calf', 'ankle']);

  type Profile = [number, number][];

  const rad = (cm: number) => cm / 100 / (2 * Math.PI);
  const circOf = (c: Record<string, number>, key: string) => c[key] ?? DEFAULT_CIRC[key];

  function interp(profile: Profile, y: number): number {
    if (profile.length === 0) return 0.1;
    if (y <= profile[0][0]) return Math.max(profile[0][1], 0.001);
    for (let i = 1; i < profile.length; i++) {
      if (y <= profile[i][0]) {
        const [y0, r0] = profile[i - 1];
        const [y1, r1] = profile[i];
        return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
      }
    }
    return profile[profile.length - 1][1];
  }

  function torsoProfile(c: Record<string, number>): Profile {
    const hip = rad(circOf(c, 'hip'));
    const abdomen = rad(circOf(c, 'abdomen'));
    const waist = rad(circOf(c, 'waist'));
    const underbust = rad(circOf(c, 'underbust'));
    const bust = rad(circOf(c, 'bust'));
    const shoulder = rad(circOf(c, 'shoulder'));
    const neck = rad(circOf(c, 'neck'));
    return [
      [0.79, 0.001],
      [0.82, hip * 0.75],
      [0.86, hip * 0.95],
      [0.9, hip],
      [0.96, (hip + abdomen) / 2],
      [1.02, abdomen],
      [1.1, waist],
      [1.16, (waist + underbust) / 2],
      [1.22, underbust],
      [1.32, bust],
      [1.39, bust * 0.94],
      [1.45, shoulder * 0.88],
      [1.5, neck * 1.25],
      [1.54, neck],
    ];
  }

  function legProfile(c: Record<string, number>): Profile {
    const ankle = rad(circOf(c, 'ankle'));
    const calf = rad(circOf(c, 'calf'));
    const thigh = rad(circOf(c, 'thigh'));
    return [
      [0.012, 0.001],
      [0.07, ankle * 0.95],
      [0.16, ankle],
      [0.34, calf],
      [0.52, (calf + thigh) / 2],
      [0.72, thigh],
      [0.88, thigh * 1.04],
    ];
  }

  function armProfile(c: Record<string, number>): Profile {
    const upper = rad(circOf(c, 'upper-arm'));
    const fore = rad(circOf(c, 'forearm'));
    const wrist = rad(circOf(c, 'wrist'));
    return [
      [0.955, 0.001],
      [0.97, wrist],
      [1.0, wrist * 1.05],
      [1.12, fore],
      [1.3, upper * 0.96],
      [1.44, upper],
      [1.48, upper * 0.85],
      [1.5, 0.001],
    ];
  }

  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;

  let renderer: THREE.WebGLRenderer | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let scene: THREE.Scene | undefined;
  let bodyGroup: THREE.Group | undefined;
  let band: THREE.Mesh | undefined;
  let ruler: THREE.Group | undefined;
  let torso: THREE.Mesh | undefined;
  let legL: THREE.Mesh | undefined;
  let legR: THREE.Mesh | undefined;
  let armL: THREE.Mesh | undefined;
  let armR: THREE.Mesh | undefined;
  let head: THREE.Mesh | undefined;

  let torsoProf: Profile = [];
  let legProf: Profile = [];
  let armProf: Profile = [];
  let armX = 0.2;
  let legX = 0.07;
  let headR = 0.09;
  let sceneReady = false;
  let dragging = false;
  let lastX = 0;
  let raf = 0;

  const lathe = (profile: Profile) =>
    new THREE.LatheGeometry(
      profile.map(([y, r]) => new THREE.Vector2(Math.max(r, 0.001), y)),
      48,
    );

  function computeProfiles(c: Record<string, number>) {
    torsoProf = torsoProfile(c);
    legProf = legProfile(c);
    armProf = armProfile(c);
    headR = rad(circOf(c, 'head'));
    legX = rad(circOf(c, 'thigh')) * 0.72;
    armX = rad(circOf(c, 'shoulder')) * 0.88 + rad(circOf(c, 'upper-arm')) + 0.005;
  }

  function rebuildBody(c: Record<string, number>) {
    computeProfiles(c);
    if (!torso || !legL || !legR || !armL || !armR || !head) return;

    torso.geometry.dispose();
    torso.geometry = lathe(torsoProf);

    for (const leg of [legL, legR]) {
      leg.geometry.dispose();
      leg.geometry = lathe(legProf);
    }
    legL.position.x = -legX;
    legR.position.x = legX;

    for (const arm of [armL, armR]) {
      arm.geometry.dispose();
      arm.geometry = lathe(armProf);
    }
    armL.position.x = -armX;
    armR.position.x = armX;

    head.geometry.dispose();
    head.geometry = new THREE.SphereGeometry(headR, 32, 24);

    if (ruler) ruler.position.x = -(armX + 0.14);
  }

  function positionBand(current: string) {
    if (!band || !ruler) return;

    // 'none' is for measurements taken off a device rather than at a place on
    // the body — weight has neither a tape position nor a height to mark.
    const showRuler = current === 'height';
    const showBand = current !== 'height' && current !== 'none';
    ruler.visible = showRuler;
    band.visible = showBand;
    if (!showBand) return;

    const y = SITE_Y[current] ?? SITE_Y.waist;
    let x = 0;
    let r: number;
    if (ARM_SITES.has(current)) {
      x = armX;
      r = interp(armProf, y);
    } else if (LEG_SITES.has(current)) {
      x = legX;
      r = interp(legProf, y);
    } else if (current === 'head') {
      r = headR;
    } else {
      r = interp(torsoProf, y);
    }
    band.position.set(x, y, 0);
    band.geometry.dispose();
    band.geometry = new THREE.TorusGeometry(r + 0.008, 0.014, 20, 72);
  }

  function resize() {
    if (!renderer || !camera || !container) return;
    const w = container.clientWidth || 1;
    renderer.setSize(w, height, false);
    camera.aspect = w / height;
    camera.updateProjectionMatrix();
  }

  $effect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    camera.position.set(0, 1.0, 3.1);
    camera.lookAt(0, 0.88, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(2.2, 3.2, 2.4);
    scene.add(sun);

    bodyGroup = new THREE.Group();
    scene.add(bodyGroup);

    computeProfiles(circumferences);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xd8d3cc,
      roughness: 0.85,
      metalness: 0.02,
    });

    torso = new THREE.Mesh(lathe(torsoProf), bodyMat);
    legL = new THREE.Mesh(lathe(legProf), bodyMat);
    legR = new THREE.Mesh(lathe(legProf), bodyMat);
    armL = new THREE.Mesh(lathe(armProf), bodyMat);
    armR = new THREE.Mesh(lathe(armProf), bodyMat);
    legL.position.x = -legX;
    legR.position.x = legX;
    armL.position.x = -armX;
    armR.position.x = armX;

    head = new THREE.Mesh(new THREE.SphereGeometry(headR, 32, 24), bodyMat);
    head.position.y = SITE_Y.head;

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.012, 48),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 1 }),
    );
    disc.position.y = -0.006;

    const bandMat = new THREE.MeshStandardMaterial({
      color: ACCENT,
      emissive: ACCENT,
      emissiveIntensity: 0.45,
      roughness: 0.4,
    });
    band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.014, 20, 72), bandMat);
    band.rotation.x = Math.PI / 2;

    const rulerMat = new THREE.MeshStandardMaterial({
      color: ACCENT,
      emissive: ACCENT,
      emissiveIntensity: 0.3,
      roughness: 0.5,
    });
    const rulerTop = SITE_Y.head + headR;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, rulerTop, 12),
      rulerMat,
    );
    pole.position.y = rulerTop / 2;
    const tickTop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.01), rulerMat);
    tickTop.position.set(0.15, rulerTop, 0);
    ruler = new THREE.Group();
    ruler.add(pole, tickTop);
    ruler.position.x = -(armX + 0.14);
    ruler.visible = false;

    bodyGroup.add(torso, legL, legR, armL, armR, head, disc, band, ruler);

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || !bodyGroup) return;
      bodyGroup.rotation.y += (e.clientX - lastX) * 0.009;
      lastX = e.clientX;
    };
    const onUp = () => {
      dragging = false;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    sceneReady = true;
    positionBand(site);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (bodyGroup && !dragging && !motionQuery.matches) {
        bodyGroup.rotation.y += 0.0035;
      }
      if (renderer && scene && camera) renderer.render(scene, camera);
    };
    tick();

    return () => {
      sceneReady = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      scene?.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const m = obj.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      renderer?.dispose();
    };
  });

  $effect(() => {
    const c = circumferences;
    if (!sceneReady) return;
    rebuildBody(c);
    positionBand(site);
  });

  $effect(() => {
    const s = site;
    if (!sceneReady) return;
    positionBand(s);
  });

  $effect(() => {
    resize();
  });
</script>

<div
  bind:this={container}
  class="relative w-full overflow-hidden"
  style:height="{height}px"
  aria-hidden="true"
>
  <canvas
    bind:this={canvas}
    class="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
  ></canvas>
</div>
