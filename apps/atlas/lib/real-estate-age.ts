/** Building-age limits available in the property search. Null means any age; zero means new only. */
export const AGE_STEPS: (number | null)[] = [null, 0, 2, 5, 10, 20]

export function ageStepLabel(step: number | null, format: (value: number) => string): string {
  if (step == null) return 'أي عمر'
  if (step === 0) return 'جديد'
  if (step === 2) return 'سنتان أو أقل'
  return `حتى ${format(step)} ${step > 10 ? 'سنة' : 'سنوات'}`
}

/** An age filter never treats a missing age as zero; it only passes when age is unfiltered or measured. */
export function ageWithin(age: number | null | undefined, maximum: number | null): boolean {
  return maximum == null || (age != null && age <= maximum)
}
