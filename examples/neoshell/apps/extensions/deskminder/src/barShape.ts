// The outline of the setter bar while it is being pulled: a stadium whose top
// and bottom edges bow inward, so the waist thins the way a stretched band
// does and the rounded ends stay at full height.
//
// border-radius only produces convex corners, so this is a clip path — which
// means absolute pixels rather than percentages. That is affordable because
// the bar's width is already computed in pixels and its height is fixed.

// Matches the bar's h-11.
export const BAR_HEIGHT_PX = 44
// How far the waist pulls in at the far end of the drag. Enough to read as a
// deformation, little enough that the chip inside never meets the edge.
export const MAX_BOW_PX = 5

export function bowedStadiumPath(width: number, height: number, bow: number): string {
  const radius = height / 2
  const left = radius
  const right = Math.max(radius, width - radius)
  const middle = width / 2
  const arc = `A ${rounded(radius)} ${rounded(radius)} 0 0 1`
  return [
    `path("M ${rounded(left)} 0`,
    `Q ${rounded(middle)} ${rounded(sag(bow))} ${rounded(right)} 0`,
    `${arc} ${rounded(right)} ${rounded(height)}`,
    `Q ${rounded(middle)} ${rounded(height - sag(bow))} ${rounded(left)} ${rounded(height)}`,
    `${arc} ${rounded(left)} 0 Z")`,
  ].join(' ')
}

// A quadratic curve reaches only half its control point's offset at the
// midpoint, so the control sits at twice the depth the edge should sag.
function sag(bow: number): number {
  return 2 * bow
}

function rounded(value: number): string {
  return `${Math.round(value * 100) / 100}`
}
