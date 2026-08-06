<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getMetricDefinitionByKey } from '$lib/metrics/catalog';
  import { getDefinitionLabel } from '$lib/metrics/labels';

  // A schematic front-facing figure whose widths follow the recorded
  // circumferences. Each girth is treated as a circle, so half-width is
  // circumference / (2π) — an approximation, since a torso is not round, but a
  // monotone one: a larger measurement always draws a wider silhouette.
  //
  // Levels without a measurement keep their proportion of the figure rather
  // than a fixed width, so a half-filled chart still reads as one body.

  let {
    values = {},
    onPick,
  }: {
    /** Comparable values (cm) per catalog key. */
    values?: Record<string, number>;
    onPick?: (key: string) => void;
  } = $props();

  type Level = {
    key: string;
    y: number;
    side: 'left' | 'right';
    /** Share of the reference half-width when unmeasured. */
    ratio: number;
    /** Anatomical site alone — the full metric name crowds the figure. */
    label: () => string;
  };

  const LEVELS: Level[] = [
    { key: 'neck-circumference', y: 52, side: 'left', ratio: 0.42, label: m.diagram_point_neck },
    { key: 'shoulder-circumference', y: 66, side: 'right', ratio: 1.18, label: m.diagram_point_shoulder },
    { key: 'bust-circumference', y: 86, side: 'left', ratio: 1.0, label: m.diagram_point_bust },
    { key: 'underbust-circumference', y: 100, side: 'right', ratio: 0.88, label: m.diagram_point_underbust },
    { key: 'waist-circumference', y: 118, side: 'left', ratio: 0.82, label: m.diagram_point_waist },
    { key: 'abdominal-circumference', y: 132, side: 'right', ratio: 0.9, label: m.diagram_point_abdomen },
    { key: 'hip-circumference', y: 150, side: 'left', ratio: 1.1, label: m.diagram_point_hip },
    { key: 'thigh-circumference', y: 182, side: 'right', ratio: 0.62, label: m.diagram_point_thigh },
    { key: 'calf-circumference', y: 220, side: 'left', ratio: 0.42, label: m.diagram_point_calf },
  ];

  const CENTER = 190;
  const LEFT_GUTTER = 96;
  const RIGHT_GUTTER = 284;
  const REFERENCE_HALF_WIDTH = 30;

  // Scale set by whichever circumference is recorded, so the figure keeps its
  // proportions whether one measurement is present or all of them.
  const scale = $derived.by(() => {
    const anchors = LEVELS.map((level) => {
      const measured = values[level.key];
      return measured !== undefined && measured > 0 ? measured / (2 * Math.PI) / level.ratio : null;
    }).filter((value): value is number => value !== null);

    if (anchors.length === 0) return REFERENCE_HALF_WIDTH;

    const mean = anchors.reduce((total, value) => total + value, 0) / anchors.length;
    return Math.min(Math.max(mean, 16), 46);
  });

  const points = $derived(
    LEVELS.map((level) => {
      const measured = values[level.key];
      const halfWidth =
        measured !== undefined && measured > 0
          ? Math.min(Math.max(measured / (2 * Math.PI), 8), 58)
          : scale * level.ratio;

      return { ...level, halfWidth, measured, shortLabel: level.label(), fullLabel: labelFor(level.key) };
    }),
  );

  function labelFor(key: string) {
    const definition = getMetricDefinitionByKey(key);
    return definition ? getDefinitionLabel(definition) : key;
  }

  function at(key: string) {
    return points.find((point) => point.key === key)!;
  }

  // Torso drawn as a smooth curve down one side and back up the other.
  const torsoPath = $derived.by(() => {
    const spine = points.filter((point) => point.y <= 150);
    const right = spine.map((point) => ({ x: CENTER + point.halfWidth, y: point.y }));
    const left = [...spine].reverse().map((point) => ({ x: CENTER - point.halfWidth, y: point.y }));
    const loop = [...right, ...left];

    return `M ${loop[0].x},${loop[0].y} ${loop
      .slice(1)
      .map((point, index) => {
        const previous = loop[index];
        const midY = (previous.y + point.y) / 2;
        return `C ${previous.x},${midY} ${point.x},${midY} ${point.x},${point.y}`;
      })
      .join(' ')} Z`;
  });

  const legPaths = $derived.by(() =>
    [-1, 1].map((direction) => {
      const hip = at('hip-circumference');
      const thigh = at('thigh-circumference');
      const calf = at('calf-circumference');
      const outerHip = CENTER + direction * hip.halfWidth;
      const inner = CENTER + direction * 2;

      return [
        `M ${outerHip},${hip.y}`,
        `C ${CENTER + direction * thigh.halfWidth * 1.5},${thigh.y - 14} ${CENTER + direction * thigh.halfWidth * 1.5},${thigh.y} ${CENTER + direction * thigh.halfWidth * 1.45},${thigh.y}`,
        `C ${CENTER + direction * calf.halfWidth * 1.7},${calf.y - 18} ${CENTER + direction * calf.halfWidth * 1.7},${calf.y} ${CENTER + direction * calf.halfWidth * 1.5},${calf.y}`,
        `L ${CENTER + direction * 12},246`,
        `L ${inner},246`,
        `L ${inner},${hip.y + 4}`,
        'Z',
      ].join(' ');
    }),
  );

  const armPaths = $derived.by(() =>
    [-1, 1].map((direction) => {
      const shoulder = at('shoulder-circumference');
      const waist = at('waist-circumference');
      const top = CENTER + direction * (shoulder.halfWidth - 2);
      const elbow = CENTER + direction * (shoulder.halfWidth + 12);
      const wrist = CENTER + direction * (waist.halfWidth + 14);

      return [
        `M ${top},${shoulder.y - 4}`,
        `C ${elbow},${shoulder.y + 12} ${elbow},${waist.y} ${wrist},${waist.y + 22}`,
        `L ${wrist - direction * 7},${waist.y + 22}`,
        `C ${elbow - direction * 8},${waist.y} ${elbow - direction * 8},${shoulder.y + 14} ${top - direction * 6},${shoulder.y + 4}`,
        'Z',
      ].join(' ');
    }),
  );

  const headCenterY = 30;
</script>

<figure class="m-0 w-full">
  <svg viewBox="0 0 380 262" class="h-auto w-full" role="img" aria-label={m.body_diagram_alt()}>
    <defs>
      <linearGradient id="body-diagram-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f5f3ff" />
        <stop offset="100%" stop-color="#ecfeff" />
      </linearGradient>
    </defs>

    <g fill="url(#body-diagram-fill)" stroke="#8b5cf6" stroke-width="1.6" stroke-linejoin="round">
      {#each armPaths as path}<path d={path} stroke-width="1.1" />{/each}
      {#each legPaths as path}<path d={path} stroke-width="1.1" />{/each}
      <circle cx={CENTER} cy={headCenterY} r="15" />
      <rect x={CENTER - 6} y={headCenterY + 12} width="12" height="12" />
      <path d={torsoPath} />
    </g>

    {#each points as point (point.key)}
      {@const measured = point.measured !== undefined}
      {@const anchorX = point.side === 'left' ? CENTER - point.halfWidth : CENTER + point.halfWidth}
      {@const textX = point.side === 'left' ? LEFT_GUTTER - 6 : RIGHT_GUTTER + 6}
      <g
        class="cursor-pointer"
        role="button"
        tabindex="0"
        aria-label={point.fullLabel}
        onclick={() => onPick?.(point.key)}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onPick?.(point.key);
          }
        }}
      >
        <ellipse
          cx={CENTER}
          cy={point.y}
          rx={point.halfWidth}
          ry="3.2"
          fill="none"
          stroke={measured ? '#7c3aed' : '#cbd5e1'}
          stroke-width={measured ? 1.5 : 1}
          stroke-dasharray={measured ? '' : '3 3'}
        />
        <line
          x1={anchorX}
          y1={point.y}
          x2={point.side === 'left' ? LEFT_GUTTER : RIGHT_GUTTER}
          y2={point.y}
          stroke={measured ? '#c4b5fd' : '#e2e8f0'}
          stroke-width="1"
        />
        <text
          x={textX}
          y={point.y - 3}
          text-anchor={point.side === 'left' ? 'end' : 'start'}
          font-size="11"
          fill={measured ? '#475569' : '#94a3b8'}
        >
          {point.shortLabel}
        </text>
        <text
          x={textX}
          y={point.y + 11}
          text-anchor={point.side === 'left' ? 'end' : 'start'}
          font-size="12.5"
          font-weight="600"
          fill={measured ? '#6d28d9' : '#cbd5e1'}
        >
          {measured ? `${Number(point.measured!.toFixed(1))} cm` : '—'}
        </text>
      </g>
    {/each}
  </svg>
</figure>
