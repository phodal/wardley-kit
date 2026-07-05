export interface TextPlacementBox {
  readonly id: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly width: number;
  readonly height: number;
  readonly ignoredObstacleIds?: readonly string[] | undefined;
  readonly ignoredSegmentIds?: readonly string[] | undefined;
}

export interface PlacedTextBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TextPlacementBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface TextPlacementSegment {
  readonly id: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface TextPlacementOptions {
  readonly obstacles?: readonly PlacedTextBox[] | undefined;
  readonly segments?: readonly TextPlacementSegment[] | undefined;
  readonly candidateMode?: "local" | "expanded" | undefined;
}

export function placeTextBoxes(
  boxes: readonly TextPlacementBox[],
  bounds: TextPlacementBounds,
  padding = 3,
  options: TextPlacementOptions = {}
): readonly PlacedTextBox[] {
  const placed: PlacedTextBox[] = [];
  const obstacles = options.obstacles ?? [];
  const segments = options.segments ?? [];
  for (const box of boxes) {
    let best: PlacedTextBox | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of textBoxCandidates(box, bounds, options.candidateMode ?? "local")) {
      let overlapCount = 0;
      const overlap = placed.reduce((sum, other) => {
        const area = overlapArea(candidate, other, padding);
        if (area > 0) {
          overlapCount += 1;
        }
        return sum + area;
      }, 0);
      let obstacleOverlapCount = 0;
      const obstacleOverlap = obstacles.reduce((sum, other) => {
        if (box.ignoredObstacleIds?.includes(other.id)) {
          return sum;
        }
        const area = overlapArea(candidate, other, padding);
        if (area > 0) {
          obstacleOverlapCount += 1;
        }
        return sum + area;
      }, 0);
      const segmentHits = segments.reduce((sum, segment) => {
        if (box.ignoredSegmentIds?.includes(segment.id)) {
          return sum;
        }
        return sum + (segmentIntersectsBox(segment, candidate, padding) ? 1 : 0);
      }, 0);
      const distance = Math.hypot(candidate.x - box.anchorX, candidate.y - box.anchorY);
      const score = overlapCount * 2000000
        + obstacleOverlapCount * 1500000
        + overlap * 1000
        + obstacleOverlap * 1000
        + segmentHits * 50000
        + distance;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
      if (score === 0) {
        break;
      }
    }
    placed.push(best ?? clampTextBox(box, box.anchorX, box.anchorY, bounds));
  }
  return placed;
}

function textBoxCandidates(box: TextPlacementBox, bounds: TextPlacementBounds, mode: "local" | "expanded"): readonly PlacedTextBox[] {
  const gap = 10;
  const x = box.anchorX;
  const y = box.anchorY;
  const step = box.height + gap;
  const local = [
    clampTextBox(box, x, y, bounds),
    clampTextBox(box, x, y - step, bounds),
    clampTextBox(box, x, y + step, bounds),
    clampTextBox(box, x, y - step * 2, bounds),
    clampTextBox(box, x, y + step * 2, bounds),
    clampTextBox(box, x + gap, y - step, bounds),
    clampTextBox(box, x + gap, y + step, bounds),
    clampTextBox(box, x - box.width - gap, y, bounds),
    clampTextBox(box, x - box.width - gap, y - step, bounds),
    clampTextBox(box, x - box.width - gap, y + step, bounds),
    clampTextBox(box, x - box.width - gap, y + step * 2, bounds),
    clampTextBox(box, x + box.width + gap, y, bounds),
    clampTextBox(box, x + box.width + gap, y - step, bounds),
    clampTextBox(box, x + box.width + gap, y + step, bounds),
    clampTextBox(box, x + box.width + gap, y + step * 2, bounds),
    clampTextBox(box, x + box.width * 0.45, y, bounds),
    clampTextBox(box, x - box.width * 0.45, y, bounds),
    clampTextBox(box, x + box.width * 0.45, y + step, bounds),
    clampTextBox(box, x - box.width * 0.45, y + step, bounds),
    clampTextBox(box, x + box.width * 0.7, y - step, bounds),
    clampTextBox(box, x - box.width * 0.7, y + step, bounds),
    clampTextBox(box, x + gap, y, bounds),
    clampTextBox(box, x - gap, y, bounds),
    clampTextBox(box, x, y - gap, bounds),
    clampTextBox(box, x, y + gap, bounds)
  ];
  if (mode === "local") {
    return uniqueTextBoxes(local);
  }
  return uniqueTextBoxes([
    ...local,
    ...expandedTextBoxCandidates(box, bounds)
  ]);
}

function expandedTextBoxCandidates(box: TextPlacementBox, bounds: TextPlacementBounds): readonly PlacedTextBox[] {
  const gap = 10;
  const width = Math.max(1, bounds.right - bounds.left - box.width);
  const height = Math.max(1, bounds.bottom - bounds.top - box.height);
  const fractions = [0, 0.18, 0.36, 0.54, 0.72, 1];
  const candidates: PlacedTextBox[] = [];
  const step = box.height + gap;
  const localXs = [-1.2, -0.75, -0.35, 0, 0.35, 0.75, 1.2].map((scale) => scale * (box.width + gap));
  const localYs = [-3, -2, -1, 0, 1, 2, 3].map((scale) => scale * step);
  for (const dx of localXs) {
    for (const dy of localYs) {
      candidates.push(clampTextBox(box, box.anchorX + dx, box.anchorY + dy, bounds));
    }
  }
  for (const fraction of fractions) {
    const x = bounds.left + width * fraction;
    candidates.push(clampTextBox(box, x, bounds.top, bounds));
    candidates.push(clampTextBox(box, x, bounds.bottom - box.height, bounds));
  }
  for (const fraction of [0.12, 0.32, 0.52, 0.72, 0.92]) {
    const y = bounds.top + height * fraction;
    candidates.push(clampTextBox(box, bounds.left, y, bounds));
    candidates.push(clampTextBox(box, bounds.right - box.width, y, bounds));
  }
  for (const radius of [1.8, 2.7, 3.6, 4.8]) {
    const dx = Math.max(box.width + gap, box.width * radius);
    const dy = Math.max(box.height + gap, box.height * radius);
    candidates.push(
      clampTextBox(box, box.anchorX - dx, box.anchorY - dy, bounds),
      clampTextBox(box, box.anchorX, box.anchorY - dy, bounds),
      clampTextBox(box, box.anchorX + dx, box.anchorY - dy, bounds),
      clampTextBox(box, box.anchorX - dx, box.anchorY, bounds),
      clampTextBox(box, box.anchorX + dx, box.anchorY, bounds),
      clampTextBox(box, box.anchorX - dx, box.anchorY + dy, bounds),
      clampTextBox(box, box.anchorX, box.anchorY + dy, bounds),
      clampTextBox(box, box.anchorX + dx, box.anchorY + dy, bounds)
    );
  }
  return candidates;
}

function uniqueTextBoxes(boxes: readonly PlacedTextBox[]): readonly PlacedTextBox[] {
  const seen = new Set<string>();
  const unique: PlacedTextBox[] = [];
  for (const box of boxes) {
    const key = `${box.x}:${box.y}:${box.width}:${box.height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(box);
  }
  return unique;
}

function clampTextBox(box: TextPlacementBox, x: number, y: number, bounds: TextPlacementBounds): PlacedTextBox {
  return {
    id: box.id,
    x: Math.round(Math.max(bounds.left, Math.min(x, bounds.right - box.width))),
    y: Math.round(Math.max(bounds.top, Math.min(y, bounds.bottom - box.height))),
    width: box.width,
    height: box.height
  };
}

function overlapArea(a: PlacedTextBox, b: PlacedTextBox, padding: number): number {
  const left = Math.max(a.x - padding, b.x - padding);
  const right = Math.min(a.x + a.width + padding, b.x + b.width + padding);
  const top = Math.max(a.y - padding, b.y - padding);
  const bottom = Math.min(a.y + a.height + padding, b.y + b.height + padding);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function segmentIntersectsBox(segment: TextPlacementSegment, box: PlacedTextBox, padding: number): boolean {
  const left = box.x - padding;
  const right = box.x + box.width + padding;
  const top = box.y - padding;
  const bottom = box.y + box.height + padding;
  const a = { x: segment.x1, y: segment.y1 };
  const b = { x: segment.x2, y: segment.y2 };
  if (pointInBox(a, left, right, top, bottom) || pointInBox(b, left, right, top, bottom)) {
    return true;
  }
  return lineSegmentsIntersect(a, b, { x: left, y: top }, { x: right, y: top })
    || lineSegmentsIntersect(a, b, { x: right, y: top }, { x: right, y: bottom })
    || lineSegmentsIntersect(a, b, { x: right, y: bottom }, { x: left, y: bottom })
    || lineSegmentsIntersect(a, b, { x: left, y: bottom }, { x: left, y: top });
}

function pointInBox(point: { readonly x: number; readonly y: number }, left: number, right: number, top: number, bottom: number): boolean {
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function lineSegmentsIntersect(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  c: { readonly x: number; readonly y: number },
  d: { readonly x: number; readonly y: number }
): boolean {
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

function orientation(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  c: { readonly x: number; readonly y: number }
): -1 | 0 | 1 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.000001) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function onSegment(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  c: { readonly x: number; readonly y: number }
): boolean {
  return b.x <= Math.max(a.x, c.x)
    && b.x >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y)
    && b.y >= Math.min(a.y, c.y);
}
