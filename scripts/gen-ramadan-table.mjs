// Prints the Ramadan table embedded in saudi_rhythm.py: for each Hijri year 1445–1465, the first and last Gregorian
// day of Ramadan on the Umm al-Qura calendar, read day by day from Node's own Intl data (islamic-umalqura, Riyadh day).
// Run: node scripts/gen-ramadan-table.mjs  → paste the output over RAMADAN in saudi_rhythm.py.
const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'numeric', day: 'numeric' })
const hijri = (d) => {
  const p = Object.fromEntries(fmt.formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, parseInt(x.value, 10)]))
  return { year: p.year, month: p.month }
}
const iso = (d) => d.toISOString().slice(0, 10)
const out = {}
// noon UTC = 15:00 Riyadh: safely inside the Saudi calendar day
for (let t = Date.UTC(2023, 0, 1, 12); t < Date.UTC(2045, 0, 1, 12); t += 86400000) {
  const d = new Date(t), h = hijri(d)
  if (h.month !== 9 || h.year < 1445 || h.year > 1465) continue
  out[h.year] ??= [iso(d), iso(d)]
  out[h.year][1] = iso(d)
}
console.log('RAMADAN = {')
for (const [y, [a, b]] of Object.entries(out)) console.log(`    ${y}: ('${a}', '${b}'),`)
console.log('}')
