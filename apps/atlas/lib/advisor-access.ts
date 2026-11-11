/** Property advice uses only listing and aggregate facts already selected in Atlas, not the restricted business directory. */
export function canUseAdvisor(mode: string, targetingAllowed: boolean) {
  return mode === 'real_estate' || targetingAllowed
}
