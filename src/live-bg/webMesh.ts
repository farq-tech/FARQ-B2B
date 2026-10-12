type Edge = { a: number; b: number; L: number }
export function webMesh(W: number, H: number, VH: number = H) {
      const points: Array<{ x: number; y: number }> = [], edges: Edge[] = []
      const add = (a: number, b: number) => edges.push({ a, b, L: Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) })
      const rays = W < 640 ? 7 : 10, factor = W < 640 ? 0.65 : 1
      for (let y = VH * 0.35; y < H + VH; y += VH * 1.6) for (const side of [0, 1]) {
        const x = side ? W + 36 : -36, rings: number[][] = []
        for (const radius of [70, 145, 250, 390, 570, 790, 1050]) {
          const ring: number[] = []
          for (let j = 0; j <= rays; j++) {
            const angle = -Math.PI / 2 + j * Math.PI / rays + (side ? Math.PI : 0)
            const r = radius * factor * (1 + 0.035 * Math.sin(j * 5 + radius))
            ring.push(points.length); points.push({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r })
            if (j > 0) add(ring[j - 1], ring[j])
            if (rings.length) add(rings[rings.length - 1][j], ring[j])
          }
          rings.push(ring)
        }
      }
  return { points, edges }
}
