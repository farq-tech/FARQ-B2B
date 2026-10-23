/**
 * Next passes the final dynamic segment of `/.../[y].pbf` as `"123.pbf"`.
 * Keep that transport suffix out of the numeric coordinate sent upstream.
 */
export function parsePbfTileY(value: string): string | null {
  const match = /^(\d{1,7})\.pbf$/.exec(value)
  return match?.[1] ?? null
}
