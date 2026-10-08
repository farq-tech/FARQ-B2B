import { useRef, useState, type DragEvent } from 'react'
import { cx, FOCUS_RING } from './cx'
import { Icon, type IconName } from './Icon'

/*
 * Dropzone — Figma «Dropzone» (21:153). State: Idle · DragOver · Uploading · Success · Error.
 * DragOver is tracked here; Uploading/Success/Error come from the caller (the real upload).
 * Progress fills from the start (right) in RTL. Error always says what to do next.
 */
export type DropzoneState = 'Idle' | 'DragOver' | 'Uploading' | 'Success' | 'Error'

type DropzoneProps = {
  state?: Exclude<DropzoneState, 'DragOver'>
  fileName?: string
  /** 0–100, Uploading only. */
  progress?: number
  /** Success line, e.g. «قرأنا 48 بند — راجعها قبل الإرسال». */
  successNote?: string
  /** Error line; must say what to do next. */
  errorNote?: string
  accept?: string
  onFiles?: (files: File[]) => void
  className?: string
}

const BOX: Record<DropzoneState, string> = {
  Idle: 'bg-[var(--color-bg-surface)] border-[1.5px] border-dashed border-[var(--color-border-strong)] hover:border-[var(--color-border-primary)]',
  DragOver: 'bg-[var(--color-bg-primary-subtle)] border-2 border-dashed border-[var(--color-border-primary)]',
  Uploading: 'bg-[var(--color-bg-surface)] border-[1.5px] border-solid border-[var(--color-border-primary)]',
  Success: 'bg-[var(--color-bg-success)] border-[1.5px] border-solid border-[var(--color-border-success)]',
  Error: 'bg-[var(--color-bg-danger)] border-[1.5px] border-solid border-[var(--color-border-danger)]',
}
const ICON: Record<DropzoneState, { name: IconName; color: string }> = {
  Idle: { name: 'upload', color: 'var(--color-icon-secondary)' },
  DragOver: { name: 'upload', color: 'var(--color-icon-primary)' },
  Uploading: { name: 'sheet', color: 'var(--color-icon-primary)' },
  Success: { name: 'check-circle', color: 'var(--color-icon-success)' },
  Error: { name: 'alert', color: 'var(--color-icon-danger)' },
}

export function Dropzone({ state = 'Idle', fileName, progress = 0, successNote, errorNote, accept = '.pdf,.xlsx,.xls,.csv,image/*', onFiles, className }: DropzoneProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const shown: DropzoneState = over && state !== 'Uploading' ? 'DragOver' : state
  const busy = state === 'Uploading'
  const pct = Math.max(0, Math.min(100, Math.round(progress)))
  const title = shown === 'Error' ? 'ما قدرنا نقرأ الملف' : shown === 'Success' ? `تم رفع الملف${fileName ? ` · ${fileName}` : ''}` : shown === 'Uploading' ? `جارٍ رفع الملف${fileName ? ` · ${fileName}` : ''}` : shown === 'DragOver' ? 'أفلت الملف هنا' : 'اسحب الملف هنا أو اختر من جهازك'
  const note = shown === 'Error' ? (errorNote || 'جرّب صورة أوضح أو ملف Excel') : shown === 'Success' ? (successNote || 'راجع البنود قبل الإرسال') : shown === 'Uploading' ? `${pct}%` : shown === 'DragOver' ? 'بنقرأ البنود تلقائيًا' : 'ملفات PDF أو Excel أو صورة — حتى 25 ميجابايت'
  const take = (list: FileList | null) => { if (list && list.length && onFiles) onFiles(Array.from(list)) }
  const drag = (e: DragEvent, on: boolean) => { e.preventDefault(); if (!busy) setOver(on) }

  return (
    <div className={cx('w-full', className)}>
    <input ref={input} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { take(e.target.files); e.target.value = '' }} />
    <button
      type="button"
      aria-disabled={busy || undefined}
      onClick={() => !busy && input.current?.click()}
      onDragOver={(e) => drag(e, true)}
      onDragEnter={(e) => drag(e, true)}
      onDragLeave={(e) => drag(e, false)}
      onDrop={(e) => { drag(e, false); if (!busy) take(e.dataTransfer.files) }}
      className={cx('flex h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] p-8 text-center transition-colors', busy && 'cursor-progress', BOX[shown], FOCUS_RING)}
    >
      <span className={cx('flex size-12 items-center justify-center rounded-[var(--radius-md)]', shown === 'Idle' ? 'bg-[var(--color-bg-surface-2)]' : 'bg-[var(--color-bg-surface)]')} style={{ color: ICON[shown].color }}>
        <Icon name={ICON[shown].name} size={24} />
      </span>
      <span className="text-[16px] leading-[26px] font-medium text-[var(--color-text-primary)]">{title}</span>
      <span className="text-[14px] leading-[22px]" style={{ color: shown === 'Error' ? 'var(--color-text-danger)' : 'var(--color-text-secondary)' }}>{note}</span>
      {shown === 'Uploading' ? (
        <span aria-hidden className="block h-1.5 w-[320px] max-w-full overflow-hidden rounded-[3px] bg-[var(--color-bg-surface-2)]">
          <span className="block h-full rounded-[3px] bg-[var(--color-bg-brand)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </button>
    {/* Announced outside the button so screen readers hear progress and errors. */}
    <p className="sr-only" role={shown === 'Error' ? 'alert' : 'status'}>{shown === 'Uploading' ? `جارٍ الرفع ${pct}%` : shown === 'Error' || shown === 'Success' ? `${title}. ${note}` : ''}</p>
    </div>
  )
}
