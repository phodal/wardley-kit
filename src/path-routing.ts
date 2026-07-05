export interface RoutePoint {
  readonly x: number;
  readonly y: number;
}

export interface RouteObstacle {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly componentId?: string | undefined;
  readonly weight?: number | undefined;
}

export interface RoutedQuadratic {
  readonly start: RoutePoint;
  readonly control: RoutePoint;
  readonly end: RoutePoint;
}

export interface RouteQuadraticOptions {
  readonly obstacles?: readonly RouteObstacle[] | undefined;
  readonly ignoredObstacleIds?: readonly string[] | undefined;
  readonly ignoredComponentIds?: readonly string[] | undefined;
  readonly padding?: number | undefined;
  readonly bendDirection?: 1 | -1 | undefined;
}

export function routeQuadraticSegment(
  start: RoutePoint,
  end: RoutePoint,
  options: RouteQuadraticOptions = {}
): RoutedQuadratic {
  const obstacles = options.obstacles ?? [];
  const padding = options.padding ?? 2;
  const ignoredObstacleIds = new Set(options.ignoredObstacleIds ?? []);
  const ignoredComponentIds = new Set(options.ignoredComponentIds ?? []);
  const candidates = quadraticControlCandidates(start, end, options.bendDirection ?? 1);
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const control of candidates) {
    const curve = { start, control, end };
    const hits = countCurveObstacleHits(curve, obstacles, ignoredObstacleIds, ignoredComponentIds, padding);
    const bend = Math.hypot(control.x - (start.x + end.x) / 2, control.y - (start.y + end.y) / 2);
    const score = hits * 100000 + bend;
    if (score < bestScore) {
      best = control;
      bestScore = score;
    }
    if (score === 0) {
      break;
    }
  }
  return { start, control: best, end };
}

export function quadraticRouteSegments(curve: RoutedQuadratic, samples = 8): readonly [RoutePoint, RoutePoint][] {
  const segments: [RoutePoint, RoutePoint][] = [];
  let previous = curve.start;
  for (let step = 1; step <= samples; step += 1) {
    const point = quadraticPoint(curve.start, curve.control, curve.end, step / samples);
    segments.push([previous, point]);
    previous = point;
  }
  return segments;
}

export function quadraticPoint(a: RoutePoint, control: RoutePoint, b: RoutePoint, t: number): RoutePoint {
  const mt = 1 - t;
  return {
    x: Math.round(mt * mt * a.x + 2 * mt * t * control.x + t * t * b.x),
    y: Math.round(mt * mt * a.y + 2 * mt * t * control.y + t * t * b.y)
  };
}

function quadraticControlCandidates(start: RoutePoint, end: RoutePoint, preferredDirection: 1 | -1): readonly RoutePoint[] {
  const mid = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return [mid];
  }
  const normal = { x: -dy / length, y: dx / length };
  const bendBase = Math.min(110, Math.max(22, length * 0.18));
  const directions = [preferredDirection, -preferredDirection] as const;
  const bends = [0, bendBase, bendBase * 1.55, bendBase * 2.1, bendBase * 3, bendBase * 4, bendBase * 6, bendBase * 8];
  const candidates: RoutePoint[] = [];
  for (const bend of bends) {
    if (bend === 0) {
      candidates.push({ x: Math.round(mid.x), y: Math.round(mid.y) });
      continue;
    }
    for (const direction of directions) {
      candidates.push({
        x: Math.round(mid.x + normal.x * bend * direction),
        y: Math.round(mid.y + normal.y * bend * direction)
      });
    }
  }
  candidates.push(
    { x: Math.round(mid.x), y: Math.round(mid.y - bendBase) },
    { x: Math.round(mid.x), y: Math.round(mid.y + bendBase) },
    { x: Math.round(mid.x - bendBase), y: Math.round(mid.y) },
    { x: Math.round(mid.x + bendBase), y: Math.round(mid.y) },
    { x: Math.round(mid.x), y: Math.round(mid.y - bendBase * 2.5) },
    { x: Math.round(mid.x), y: Math.round(mid.y + bendBase * 2.5) },
    { x: Math.round(mid.x - bendBase * 2.5), y: Math.round(mid.y) },
    { x: Math.round(mid.x + bendBase * 2.5), y: Math.round(mid.y) },
    { x: Math.round(mid.x), y: Math.round(mid.y - bendBase * 5) },
    { x: Math.round(mid.x), y: Math.round(mid.y + bendBase * 5) },
    { x: Math.round(mid.x - bendBase * 5), y: Math.round(mid.y) },
    { x: Math.round(mid.x + bendBase * 5), y: Math.round(mid.y) }
  );
  return candidates;
}

function countCurveObstacleHits(
  curve: RoutedQuadratic,
  obstacles: readonly RouteObstacle[],
  ignoredObstacleIds: ReadonlySet<string>,
  ignoredComponentIds: ReadonlySet<string>,
  padding: number
): number {
  const segments = quadraticRouteSegments(curve);
  let hits = 0;
  for (const obstacle of obstacles) {
    if (ignoredObstacleIds.has(obstacle.id) || (obstacle.componentId && ignoredComponentIds.has(obstacle.componentId))) {
      continue;
    }
    if (segments.some(([a, b]) => segmentIntersectsBox(a, b, obstacle, padding))) {
      hits += obstacle.weight ?? 1;
    }
  }
  return hits;
}

function segmentIntersectsBox(a: RoutePoint, b: RoutePoint, box: RouteObstacle, padding: number): boolean {
  const left = box.x - padding;
  const right = box.x + box.width + padding;
  const top = box.y - padding;
  const bottom = box.y + box.height + padding;
  if (pointInBox(a, left, right, top, bottom) || pointInBox(b, left, right, top, bottom)) {
    return true;
  }
  return lineSegmentsIntersect(a, b, { x: left, y: top }, { x: right, y: top })
    || lineSegmentsIntersect(a, b, { x: right, y: top }, { x: right, y: bottom })
    || lineSegmentsIntersect(a, b, { x: right, y: bottom }, { x: left, y: bottom })
    || lineSegmentsIntersect(a, b, { x: left, y: bottom }, { x: left, y: top });
}

function pointInBox(point: RoutePoint, left: number, right: number, top: number, bottom: number): boolean {
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function lineSegmentsIntersect(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC === 0 && onSegment(a, c, b)) return true;
  if (abD === 0 && onSegment(a, d, b)) return true;
  if (cdA === 0 && onSegment(c, a, d)) return true;
  if (cdB === 0 && onSegment(c, b, d)) return true;
  return abC !== abD && cdA !== cdB;
}

function orientation(a: RoutePoint, b: RoutePoint, c: RoutePoint): -1 | 0 | 1 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.000001) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function onSegment(a: RoutePoint, b: RoutePoint, c: RoutePoint): boolean {
  return b.x <= Math.max(a.x, c.x)
    && b.x >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y)
    && b.y >= Math.min(a.y, c.y);
}
