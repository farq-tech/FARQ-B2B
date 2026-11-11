# -*- coding: utf-8 -*-
"""Rebuild every Atlas enrichment *delta* table from one entry point.

Maintenance of the golden data (``docs/golden-data.md``) means re-running a
handful of ``build_*.py`` modules in the right order, because some of them
consume another's delta:

  * ``build_status_confidence`` reads the ``build_status_vote`` delta.
  * ``build_hours_salvage``     reads the ``build_hours_canonical`` delta.
  * ``build_name_polish``       reads the ``build_name_ar`` delta.

Running them by hand is error-prone (wrong order, a stale intermediate, a
silently skipped step). This module is a thin *orchestrator*: it knows the
dependency graph, runs the steps in topological order, hands each step its
resolved inputs (the base ``targets.parquet`` plus any upstream delta it
consumes), and prints one ordered summary. It owns **no** build logic — every
step delegates to the existing builder module's own callable entry point.

Guarantees (CLAUDE.md — المستخدم أولاً / المستوى العالمي):

  * It never mutates the input ``targets.parquet``; it only writes deltas into
    ``--out-dir``.
  * It does not publish, does not call railway, does not touch any release.
  * No silent partial success: if any step raises, the run stops, the failing
    step is named, and the process exits non-zero.
  * Everything is importable and testable without a real parquet: the step
    registry, the topological order and the plan are pure data, and each
    builder is only imported when its step actually runs.

CLI
---
    python build_golden.py --targets BASE.parquet --out-dir DIR [options]

      --only  a,b,c   run only these steps (their dependencies are pulled in)
      --skip  a,b     run everything except these
      --dry-run       print the ordered plan (resolved input/output paths) and
                      exit without running anything
      --temp-dir DIR  temp directory passed to the duckdb-backed steps
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Callable, Dict, List, Optional, Sequence, Tuple


# --------------------------------------------------------------------------- #
# Step registry
# --------------------------------------------------------------------------- #
class Step:
    """One build step.

    Attributes
    ----------
    name     : stable identifier used on the CLI and as the delta basename stem.
    output   : filename (within ``--out-dir``) this step writes.
    deps     : names of steps whose output this step consumes as input.
    run      : callable ``(base, out_path, dep_outputs, temp_dir) -> rows:int``.
               ``dep_outputs`` maps each dependency name to its resolved output
               path. The callable imports and invokes the real builder; it is a
               plain attribute so a test can monkeypatch it with a fake.
    """

    __slots__ = ("name", "output", "deps", "run")

    def __init__(self, name: str, output: str, deps: Sequence[str], run: Callable):
        self.name = name
        self.output = output
        self.deps = tuple(deps)
        self.run = run

    def __repr__(self) -> str:  # pragma: no cover - debug aid only
        return f"Step({self.name!r}, deps={self.deps!r})"


# ---- builder adapters --------------------------------------------------------
# Each adapter normalises one builder's own interface (function name, argument
# order, return type) to the common ``(base, out_path, deps, temp_dir) -> int``
# shape. Imports are local so importing build_golden costs nothing and a run
# only loads the builders it needs.

def _run_status_vote(base, out_path, deps, temp_dir):
    import build_status_vote
    return int(build_status_vote.build(base, out_path, temp_directory=temp_dir))


def _run_status_confidence(base, out_path, deps, temp_dir):
    import build_status_confidence
    return int(build_status_confidence.build(
        base, deps["status_vote"], out_path, temp_directory=temp_dir))


def _run_hours_canonical(base, out_path, deps, temp_dir):
    import build_hours_canonical
    stats = build_hours_canonical.build_delta(base_parquet=base, out_path=out_path)
    return int(stats["matched"])


def _run_hours_salvage(base, out_path, deps, temp_dir):
    import build_hours_salvage
    stats = build_hours_salvage.build_delta(
        base_parquet=base, canonical_delta=deps["hours_canonical"], out_path=out_path)
    return int(stats["recovered"])


def _run_name_ar(base, out_path, deps, temp_dir):
    import build_name_ar
    return int(len(build_name_ar.build_delta(base, out_path)))


def _run_name_polish(base, out_path, deps, temp_dir):
    import build_name_polish
    return int(len(build_name_polish.build_delta(base, deps["name_ar"], out_path)))


def _run_contacts(base, out_path, deps, temp_dir):
    import build_contacts
    return int(build_contacts.build(base, out_path, temp_dir=temp_dir))


def build_steps() -> "Dict[str, Step]":
    """Return the step registry as an ordered ``{name: Step}`` mapping.

    A fresh dict every call so a test can monkeypatch one step's ``run``
    without leaking into another test.
    """
    steps = [
        Step("status_vote", "status_vote.parquet", (), _run_status_vote),
        Step("status_confidence", "status_confidence.parquet",
             ("status_vote",), _run_status_confidence),
        Step("hours_canonical", "hours_canonical.parquet", (), _run_hours_canonical),
        Step("hours_salvage", "hours_salvage.parquet",
             ("hours_canonical",), _run_hours_salvage),
        Step("name_ar", "name_ar.parquet", (), _run_name_ar),
        Step("name_polish", "name_polish.parquet", ("name_ar",), _run_name_polish),
        Step("contacts", "contacts.parquet", (), _run_contacts),
    ]
    return {s.name: s for s in steps}


# --------------------------------------------------------------------------- #
# Selection + ordering (pure)
# --------------------------------------------------------------------------- #
class PlanError(ValueError):
    """A plan could not be resolved (unknown step, skipped dependency, cycle)."""


def select_steps(
    registry: "Dict[str, Step]",
    only: Optional[Sequence[str]] = None,
    skip: Optional[Sequence[str]] = None,
) -> "List[str]":
    """Resolve which step names to run.

    ``--only`` keeps just those steps and transitively pulls in the
    dependencies they need (you cannot build ``name_polish`` without
    ``name_ar``). ``--skip`` then removes names from the result. Removing a
    step that a surviving step still depends on is reported by
    :func:`resolve_order`, not silently ignored.

    Unknown names in ``only`` / ``skip`` raise :class:`PlanError`.
    """
    known = set(registry)
    only = list(only or [])
    skip = list(skip or [])
    for bad in [n for n in only + skip if n not in known]:
        raise PlanError(f"unknown step: {bad!r} (known: {', '.join(registry)})")

    if only:
        wanted = set()
        stack = list(only)
        while stack:
            n = stack.pop()
            if n in wanted:
                continue
            wanted.add(n)
            stack.extend(registry[n].deps)
    else:
        wanted = set(known)

    wanted -= set(skip)
    # Preserve registry order for a stable, readable result.
    return [n for n in registry if n in wanted]


def resolve_order(
    registry: "Dict[str, Step]",
    selected: Sequence[str],
    available: Optional[Sequence[str]] = None,
) -> "List[Step]":
    """Topologically sort ``selected`` so every dependency precedes its
    dependent.

    A dependency that is not itself selected is allowed only when its output is
    already ``available`` on disk (the caller passes the basenames it found in
    ``--out-dir``); otherwise :class:`PlanError` is raised rather than running a
    step against a missing input. Ties are broken by registry order for a
    deterministic plan. A dependency cycle raises :class:`PlanError`.
    """
    selected = list(selected)
    sel = set(selected)
    have = set(available or [])
    order_index = {n: i for i, n in enumerate(registry)}

    # Validate dependencies are satisfiable.
    for n in selected:
        for dep in registry[n].deps:
            if dep not in sel and dep not in have:
                raise PlanError(
                    f"step {n!r} needs {dep!r}, which is neither selected nor "
                    f"already present in the output dir"
                )

    # Kahn's algorithm over the induced subgraph (edges from in-selection deps).
    indeg = {n: 0 for n in selected}
    children: "Dict[str, List[str]]" = {n: [] for n in selected}
    for n in selected:
        for dep in registry[n].deps:
            if dep in sel:
                indeg[n] += 1
                children[dep].append(n)

    ready = sorted((n for n in selected if indeg[n] == 0), key=order_index.get)
    out: "List[str]" = []
    while ready:
        n = ready.pop(0)
        out.append(n)
        newly = []
        for c in children[n]:
            indeg[c] -= 1
            if indeg[c] == 0:
                newly.append(c)
        if newly:
            ready.extend(sorted(newly, key=order_index.get))
            ready.sort(key=order_index.get)

    if len(out) != len(selected):
        cyclic = sorted(set(selected) - set(out))
        raise PlanError(f"dependency cycle among: {', '.join(cyclic)}")

    return [registry[n] for n in out]


# --------------------------------------------------------------------------- #
# Plan
# --------------------------------------------------------------------------- #
class PlannedStep:
    """A step with its resolved input and output paths, ready to run or print."""

    __slots__ = ("step", "inputs", "output", "dep_outputs")

    def __init__(self, step: Step, inputs: "List[str]", output: str,
                 dep_outputs: "Dict[str, str]"):
        self.step = step
        self.inputs = inputs
        self.output = output
        self.dep_outputs = dep_outputs


def make_plan(
    targets: str,
    out_dir: str,
    registry: Optional["Dict[str, Step]"] = None,
    only: Optional[Sequence[str]] = None,
    skip: Optional[Sequence[str]] = None,
    available: Optional[Sequence[str]] = None,
) -> "List[PlannedStep]":
    """Return the ordered list of :class:`PlannedStep` for a run.

    Pure: resolves selection, order and paths without touching disk or running
    any builder. ``available`` is the set of step names whose delta already
    exists in ``out_dir`` (used to satisfy a skipped dependency); when ``None``
    the caller is responsible — :func:`run` fills it from the directory.
    """
    registry = registry if registry is not None else build_steps()
    selected = select_steps(registry, only=only, skip=skip)
    ordered = resolve_order(registry, selected, available=available)

    planned: "List[PlannedStep]" = []
    for step in ordered:
        dep_outputs = {dep: os.path.join(out_dir, registry[dep].output)
                       for dep in step.deps}
        inputs = [targets] + [dep_outputs[dep] for dep in step.deps]
        output = os.path.join(out_dir, step.output)
        planned.append(PlannedStep(step, inputs, output, dep_outputs))
    return planned


def format_plan(planned: "Sequence[PlannedStep]") -> str:
    """Render the plan as the human-readable block printed by ``--dry-run``."""
    lines = [f"plan: {len(planned)} step(s)"]
    width = max((len(p.step.name) for p in planned), default=0)
    for i, p in enumerate(planned, 1):
        ins = ", ".join(p.inputs)
        lines.append(f"  {i}. {p.step.name:<{width}}  in [{ins}]  ->  {p.output}")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Run
# --------------------------------------------------------------------------- #
class StepFailed(RuntimeError):
    """A build step raised while running; carries the step name and the cause."""

    def __init__(self, step_name: str, cause: BaseException):
        super().__init__(f"step {step_name!r} failed: {cause}")
        self.step_name = step_name
        self.cause = cause


def _existing_outputs(registry: "Dict[str, Step]", out_dir: str) -> "List[str]":
    """Names whose delta file already exists in ``out_dir``."""
    return [n for n, s in registry.items()
            if os.path.isfile(os.path.join(out_dir, s.output))]


def run(
    targets: str,
    out_dir: str,
    only: Optional[Sequence[str]] = None,
    skip: Optional[Sequence[str]] = None,
    dry_run: bool = False,
    temp_dir: Optional[str] = None,
    registry: Optional["Dict[str, Step]"] = None,
    log: Callable[[str], None] = print,
) -> "List[Tuple[str, int, str]]":
    """Execute (or, with ``dry_run``, just print) the orchestration.

    Returns a list of ``(step_name, rows_written, output_path)`` for the steps
    that ran. Raises :class:`StepFailed` as soon as a step raises, after logging
    which step failed — nothing downstream runs. Never writes to ``targets``.
    """
    registry = registry if registry is not None else build_steps()
    available = _existing_outputs(registry, out_dir) if os.path.isdir(out_dir) else []
    planned = make_plan(targets, out_dir, registry=registry,
                        only=only, skip=skip, available=available)

    if dry_run:
        log(format_plan(planned))
        log("dry-run: nothing was built.")
        return []

    if not os.path.isfile(targets):
        raise PlanError(f"targets parquet not found: {targets}")
    os.makedirs(out_dir, exist_ok=True)

    summary: "List[Tuple[str, int, str]]" = []
    for p in planned:
        name = p.step.name
        log(f"-> {name}: {os.path.basename(p.output)}")
        try:
            rows = p.step.run(targets, p.output, p.dep_outputs, temp_dir)
        except Exception as exc:  # noqa: BLE001 - re-raised as StepFailed below
            log(f"!! {name}: FAILED ({exc})")
            raise StepFailed(name, exc) from exc
        summary.append((name, int(rows), p.output))
        log(f"   {name}: {rows} rows -> {p.output}")

    log("")
    log(f"done: {len(summary)} step(s)")
    width = max((len(n) for n, _, _ in summary), default=0)
    for name, rows, path in summary:
        log(f"  {name:<{width}}  {rows:>9} rows  {path}")
    return summary


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _split_csv(value: Optional[str]) -> "List[str]":
    if not value:
        return []
    return [tok.strip() for tok in value.split(",") if tok.strip()]


def build_arg_parser() -> argparse.ArgumentParser:
    registry = build_steps()
    ap = argparse.ArgumentParser(
        prog="build_golden.py",
        description="Rebuild all Atlas enrichment delta tables in dependency order.",
    )
    ap.add_argument("--targets", required=True,
                    help="base targets.parquet (read-only input; never mutated)")
    ap.add_argument("--out-dir", required=True,
                    help="directory where the delta parquet files are written")
    ap.add_argument("--only", default=None,
                    help="comma-separated steps to run (dependencies pulled in). "
                         "Known: " + ", ".join(registry))
    ap.add_argument("--skip", default=None,
                    help="comma-separated steps to exclude")
    ap.add_argument("--temp-dir", default=None,
                    help="temp directory for the duckdb-backed steps")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the ordered plan and exit without building")
    return ap


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        run(
            targets=args.targets,
            out_dir=args.out_dir,
            only=_split_csv(args.only) or None,
            skip=_split_csv(args.skip) or None,
            dry_run=args.dry_run,
            temp_dir=args.temp_dir,
        )
    except PlanError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except StepFailed as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
