<script lang="ts">
  import * as THREE from 'three';

  // A rotatable figure whose torso radius at each level follows the recorded
  // circumference, with a highlighted band at the site being explained. Built
  // from primitives — no external model to license, download or keep in sync.

  let {
    site,
    circumferences = {},
    height = 360,
  }: { site: string; circumferences?: Record<string, number>; height?: number } = $props();

  // Body-space heights, 0 at the feet and 1 at the crown.
  const SITES: Record<string, { level: number; radiusKey?: string; kind: 'band' | 'full' }> = {
    head: { level: 0.94, kind: 'band' },
    neck: { level: 0.86, radiusKey: 'neck', kind: 'band' },
    shoulder: { level: 0.8, radiusKey: 'shoulder', kind: 'band' },
    bust: { level: 0.72, radiusKey: 'bust', kind: 'band' },
    underbust: { level: 0.67, radiusKey: 'underbust', kind: 'band' },
    waist: { level: 0.61, radiusKey: 'waist', kind: 'band' },
    abdomen: { level: 0.57, radiusKey: 'abdomen', kind: 'band' },
    hip: { level: 0.5, radiusKey: 'hip', kind: 'band' },
    thigh: { level: 0.38, radiusKey: 'thigh', kind: 'band' },
    calf: { level: 0.2, radiusKey: 'calf', kind: 'band' },
    'upper-arm': { level: 0.68, kind: 'band' },
    forearm: { level: 0.58, kind: 'band' },
    wrist: { level: 0.5, kind: 'band' },
    ankle: { level: 0.08, kind: 'band' },
    height: { level: 0.5, kind: 'full' },
  };

  // Torso profile: level, then the default radius as a share of body width.
  const PROFILE: Array<{ level: number; key?: string; ratio: number }> = [
    { level: 0.5, key: 'hip', ratio: 1.08 },
    { level: 0.57, key: 'abdomen', ratio: 0.9 },
    { level: 0.61, key: 'waist', ratio: 0.82 },
    { level: 0.67, key: 'underbust', ratio: 0.88 },
    { level: 0.72, key: 'bust', ratio: 1.0 },
    { level: 0.8, key: 'shoulder', ratio: 1.15 },
    { level: 0.85, key: 'neck', ratio: 0.42 },
  ];

  const BASE_RADIUS = 0.26;
  const BODY_HEIGHT = 3.4;
  /** Scene units per centimetre, taking the figure as roughly 170 cm tall. */
  const UNITS_PER_CM = BODY_HEIGHT / 170;

  let container = $state<HTMLDivElement | null>(null);
  let bandLevel = $state(SITES.waist.level);

  function radiusFor(key: string | undefined, ratio: number) {
    const measured = key ? circumferences[key] : undefined;
    if (measured && measured > 0) {
      return Math.min(Math.max((measured / (2 * Math.PI)) * UNITS_PER_CM, 0.09), 0.6);
    }
    return BASE_RADIUS * ratio;
  }

  function radiusAtLevel(level: number) {
    const sorted = [...PROFILE].sort((a, b) => a.level - b.level);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    if (level <= first.level) return radiusFor(first.key, first.ratio);
    if (level >= last.level) return radiusFor(last.key, last.ratio);

    for (let index = 0; index < sorted.length - 1; index += 1) {
      const lower = sorted[index];
      const upper = sorted[index + 1];

      if (level >= lower.level && level <= upper.level) {
        const t = (level - lower.level) / (upper.level - lower.level);
        return radiusFor(lower.key, lower.ratio) * (1 - t) + radiusFor(upper.key, upper.ratio) * t;
      }
    }

    return BASE_RADIUS;
  }

  function toSceneY(level: number) {
    return (level - 0.5) * BODY_HEIGHT;
  }

  $effect(() => {
    const target = SITES[site] ?? SITES.waist;
    bandLevel = target.level;
  });

  $effect(() => {
    const host = container;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, 6.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth || 320, height, false);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = `${height}px`;
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.touchAction = 'pan-y';

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc4b5fd, 0.8);
    rim.position.set(-4, 1, -3);
    scene.add(rim);

    const figure = new THREE.Group();
    scene.add(figure);

    const skin = new THREE.MeshStandardMaterial({
      color: 0xe9e4ff,
      roughness: 0.72,
      metalness: 0.02,
      transparent: true,
      opacity: 0.96,
    });

    const disposables: Array<{ dispose: () => void }> = [skin];

    // Torso as a lathe through the measured profile.
    const profilePoints: THREE.Vector2[] = [];
    for (let level = 0.48; level <= 0.87; level += 0.01) {
      profilePoints.push(new THREE.Vector2(radiusAtLevel(level), toSceneY(level)));
    }
    const torsoGeometry = new THREE.LatheGeometry(profilePoints, 48);
    disposables.push(torsoGeometry);
    figure.add(new THREE.Mesh(torsoGeometry, skin));

    // Head and neck.
    const headGeometry = new THREE.SphereGeometry(0.26, 32, 24);
    disposables.push(headGeometry);
    const head = new THREE.Mesh(headGeometry, skin);
    head.position.y = toSceneY(0.955);
    head.scale.set(0.92, 1.12, 0.96);
    figure.add(head);

    const neckGeometry = new THREE.CylinderGeometry(0.1, 0.12, 0.22, 24);
    disposables.push(neckGeometry);
    const neck = new THREE.Mesh(neckGeometry, skin);
    neck.position.y = toSceneY(0.885);
    figure.add(neck);

    // Limbs.
    const armGeometry = new THREE.CapsuleGeometry(0.075, 1.05, 6, 16);
    disposables.push(armGeometry);
    const legGeometry = new THREE.CapsuleGeometry(0.115, 1.35, 6, 16);
    disposables.push(legGeometry);

    for (const direction of [-1, 1]) {
      const arm = new THREE.Mesh(armGeometry, skin);
      arm.position.set(direction * (radiusAtLevel(0.78) + 0.11), toSceneY(0.66), 0);
      arm.rotation.z = direction * 0.06;
      figure.add(arm);

      const leg = new THREE.Mesh(legGeometry, skin);
      leg.position.set(direction * 0.15, toSceneY(0.27), 0);
      figure.add(leg);
    }

    // The measuring band.
    const bandMaterial = new THREE.MeshStandardMaterial({
      color: 0x7c3aed,
      roughness: 0.35,
      emissive: 0x4c1d95,
      emissiveIntensity: 0.25,
    });
    disposables.push(bandMaterial);

    let bandMesh: THREE.Mesh | null = null;
    let bandGeometry: THREE.TorusGeometry | null = null;

    function placeBand(level: number) {
      if (bandMesh) {
        figure.remove(bandMesh);
        bandGeometry?.dispose();
      }

      const radius = radiusAtLevel(level) + 0.035;
      bandGeometry = new THREE.TorusGeometry(radius, 0.028, 12, 48);
      bandMesh = new THREE.Mesh(bandGeometry, bandMaterial);
      bandMesh.rotation.x = Math.PI / 2;
      bandMesh.position.y = toSceneY(level);
      bandMesh.scale.z = 1;
      figure.add(bandMesh);
    }

    placeBand(bandLevel);

    // Pointer drag, so the band can be inspected from behind.
    let dragging = false;
    let lastX = 0;
    let velocity = 0;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const delta = (event.clientX - lastX) / 140;
      figure.rotation.y += delta;
      velocity = delta;
      lastX = event.clientX;
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      renderer.domElement.style.cursor = 'grab';
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;

    const resize = () => {
      const width = host.clientWidth || 320;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const render = () => {
      if (!dragging) {
        if (Math.abs(velocity) > 0.0005) {
          figure.rotation.y += velocity;
          velocity *= 0.94;
        } else if (!reduceMotion) {
          figure.rotation.y += 0.0032;
        }
      }

      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    render();

    // Reposition the band when the site changes, without rebuilding the scene.
    const stopBandWatch = $effect.root(() => {
      $effect(() => {
        placeBand(bandLevel);
      });
    });

    return () => {
      stopBandWatch();
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      bandGeometry?.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  });
</script>

<div bind:this={container} class="w-full overflow-hidden rounded-xl bg-gradient-to-b from-violet-50/70 to-white" style={`height: ${height}px`}></div>
