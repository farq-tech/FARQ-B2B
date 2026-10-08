// Copied (moved from src/mobile/ to src/lib/, imports unchanged in meaning: '../api/…' paths are the same depth) from فرق بناء (read-only source): farqconstraction/src/mobile/imageShrink.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
/** Phone photos and picked images, shrunk to what the document reader needs. */
/** A phone photo shrunk to a size the reader needs (longest side 1600 px, JPEG). */
export async function shrinkImage(source: Blob | HTMLVideoElement): Promise<{ mime: string; base64: string; url: string }> {
  let width: number
  let height: number
  let draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  if (source instanceof HTMLVideoElement) {
    width = source.videoWidth
    height = source.videoHeight
    draw = (ctx, w, h) => ctx.drawImage(source, 0, 0, w, h)
  } else {
    // createImageBitmap first; an <img> decode when it refuses the file.
    const bitmap = await createImageBitmap(source).catch(() => null)
    if (bitmap) {
      width = bitmap.width
      height = bitmap.height
      draw = (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h)
    } else {
      const src = URL.createObjectURL(source)
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('لم نستطع فتح الصورة. جرّب صورة أخرى.'))
        el.src = src
      }).finally(() => window.setTimeout(() => URL.revokeObjectURL(src), 5000))
      width = img.naturalWidth
      height = img.naturalHeight
      draw = (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h)
    }
  }
  const scale = Math.min(1, 1600 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')!
  draw(ctx, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/jpeg', 0.8)
  return { mime: 'image/jpeg', base64: url.split(',')[1] || '', url }
}
