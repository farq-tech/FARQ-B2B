# -*- coding: utf-8 -*-
"""Tests for build_golden: the delta-rebuild orchestrator.

These exercise only the orchestration (selection, topological order, plan,
fail-fast) with monkeypatched step runners and tiny fixtures, so they are fast
and need no real parquet data or duckdb.
"""
import os
import tempfile
import unittest

import build_golden as bg


def _fake_registry(calls):
    """A registry mirroring the real dependency graph, whose runners only record
    the order they were called in and the dep paths they were handed."""
    def maker(name):
        def run(base, out_path, dep_outputs, temp_dir):
            calls.append((name, base, out_path, dict(dep_outputs)))
            return len(calls)  # a deterministic, nonzero row count
        return run

    steps = [
        bg.Step("status_vote", "status_vote.parquet", (), maker("status_vote")),
        bg.Step("status_confidence", "status_confidence.parquet",
                ("status_vote",), maker("status_confidence")),
        bg.Step("hours_canonical", "hours_canonical.parquet", (), maker("hours_canonical")),
        bg.Step("hours_salvage", "hours_salvage.parquet",
                ("hours_canonical",), maker("hours_salvage")),
        bg.Step("name_ar", "name_ar.parquet", (), maker("name_ar")),
        bg.Step("name_polish", "name_polish.parquet", ("name_ar",), maker("name_polish")),
        bg.Step("contacts", "contacts.parquet", (), maker("contacts")),
    ]
    return {s.name: s for s in steps}


class TestRegistryShape(unittest.TestCase):
    def test_real_registry_declares_the_known_dependency_edges(self):
        reg = bg.build_steps()
        self.assertEqual(reg["status_confidence"].deps, ("status_vote",))
        self.assertEqual(reg["hours_salvage"].deps, ("hours_canonical",))
        self.assertEqual(reg["name_polish"].deps, ("name_ar",))
        # The four base-only steps consume nothing but the targets file.
        for root in ("status_vote", "hours_canonical", "name_ar", "contacts"):
            self.assertEqual(reg[root].deps, ())


class TestTopologicalOrder(unittest.TestCase):
    def setUp(self):
        self.reg = bg.build_steps()

    def test_full_order_places_every_dependency_before_its_dependent(self):
        order = [s.name for s in bg.resolve_order(self.reg, bg.select_steps(self.reg))]
        self.assertEqual(sorted(order), sorted(self.reg))  # all steps, once each
        for dependent, dep in (("status_confidence", "status_vote"),
                               ("hours_salvage", "hours_canonical"),
                               ("name_polish", "name_ar")):
            self.assertLess(order.index(dep), order.index(dependent),
                            f"{dep} must run before {dependent}")

    def test_order_is_independent_of_input_ordering(self):
        # A scrambled selection must still come back topologically sorted.
        scrambled = ["name_polish", "status_confidence", "name_ar",
                     "hours_salvage", "status_vote", "hours_canonical", "contacts"]
        order = [s.name for s in bg.resolve_order(self.reg, scrambled)]
        for dependent, dep in (("status_confidence", "status_vote"),
                               ("hours_salvage", "hours_canonical"),
                               ("name_polish", "name_ar")):
            self.assertLess(order.index(dep), order.index(dependent))

    def test_cycle_is_rejected(self):
        a = bg.Step("a", "a.parquet", ("b",), lambda *x: 0)
        b = bg.Step("b", "b.parquet", ("a",), lambda *x: 0)
        reg = {"a": a, "b": b}
        with self.assertRaises(bg.PlanError):
            bg.resolve_order(reg, ["a", "b"])


class TestSelection(unittest.TestCase):
    def setUp(self):
        self.reg = bg.build_steps()

    def test_only_pulls_in_transitive_dependencies(self):
        sel = bg.select_steps(self.reg, only=["name_polish"])
        self.assertEqual(set(sel), {"name_ar", "name_polish"})

    def test_only_single_root_is_just_itself(self):
        self.assertEqual(bg.select_steps(self.reg, only=["contacts"]), ["contacts"])

    def test_skip_removes_a_step(self):
        sel = bg.select_steps(self.reg, skip=["contacts"])
        self.assertNotIn("contacts", sel)
        self.assertIn("status_vote", sel)

    def test_only_then_skip_compose(self):
        # Select the hours pair, then drop salvage -> only canonical remains.
        sel = bg.select_steps(self.reg, only=["hours_salvage"], skip=["hours_salvage"])
        self.assertEqual(set(sel), {"hours_canonical"})

    def test_unknown_step_name_is_an_error(self):
        with self.assertRaises(bg.PlanError):
            bg.select_steps(self.reg, only=["does_not_exist"])

    def test_skipping_a_needed_dependency_is_refused_when_not_on_disk(self):
        # Keep name_polish but skip its dependency name_ar, with nothing on disk.
        sel = bg.select_steps(self.reg, skip=["name_ar"])
        with self.assertRaises(bg.PlanError):
            bg.resolve_order(self.reg, sel, available=[])

    def test_skipped_dependency_allowed_when_its_delta_already_exists(self):
        sel = bg.select_steps(self.reg, skip=["name_ar"])
        order = bg.resolve_order(self.reg, sel, available=["name_ar"])
        names = [s.name for s in order]
        self.assertIn("name_polish", names)
        self.assertNotIn("name_ar", names)


class TestPlanPaths(unittest.TestCase):
    def test_dependent_input_is_the_producers_output_path(self):
        reg = bg.build_steps()
        plan = bg.make_plan("/base/targets.parquet", "/out", registry=reg)
        by_name = {p.step.name: p for p in plan}
        vote_out = by_name["status_vote"].output
        conf = by_name["status_confidence"]
        self.assertEqual(vote_out, os.path.join("/out", "status_vote.parquet"))
        # status_confidence consumes exactly the base targets + the vote delta.
        self.assertEqual(conf.inputs, ["/base/targets.parquet", vote_out])
        self.assertEqual(conf.dep_outputs, {"status_vote": vote_out})

    def test_root_step_consumes_only_the_base_targets(self):
        plan = bg.make_plan("/base/targets.parquet", "/out")
        contacts = next(p for p in plan if p.step.name == "contacts")
        self.assertEqual(contacts.inputs, ["/base/targets.parquet"])
        self.assertEqual(contacts.dep_outputs, {})


class TestDryRun(unittest.TestCase):
    def test_dry_run_prints_the_plan_and_runs_nothing(self):
        calls = []
        reg = _fake_registry(calls)
        lines = []
        with tempfile.TemporaryDirectory() as out_dir:
            result = bg.run("/base/targets.parquet", out_dir, dry_run=True,
                            registry=reg, log=lines.append)
        self.assertEqual(calls, [])           # no runner invoked
        self.assertEqual(result, [])
        text = "\n".join(lines)
        self.assertIn("plan:", text)
        self.assertIn("dry-run", text)
        # Every step and the resolved dependency path appear in the printed plan.
        self.assertIn("status_confidence", text)
        self.assertIn(os.path.join(out_dir, "status_vote.parquet"), text)

    def test_dry_run_does_not_require_the_targets_file_to_exist(self):
        reg = _fake_registry([])
        # No targets on disk, no out dir created: dry-run must still succeed.
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = os.path.join(tmp, "nope")
            bg.run("/does/not/exist.parquet", out_dir, dry_run=True,
                   registry=reg, log=lambda _l: None)
            self.assertFalse(os.path.exists(out_dir))  # nothing was created


class TestRunExecution(unittest.TestCase):
    def test_steps_run_in_topological_order_and_consumer_after_producer(self):
        calls = []
        reg = _fake_registry(calls)
        with tempfile.TemporaryDirectory() as out_dir:
            targets = os.path.join(out_dir, "targets.parquet")
            open(targets, "w").close()
            summary = bg.run(targets, out_dir, registry=reg, log=lambda _l: None)

        order = [c[0] for c in calls]
        self.assertEqual(len(summary), len(reg))
        for dependent, dep in (("status_confidence", "status_vote"),
                               ("hours_salvage", "hours_canonical"),
                               ("name_polish", "name_ar")):
            self.assertLess(order.index(dep), order.index(dependent))

        # The consumer was actually handed the producer's output path.
        conf_call = next(c for c in calls if c[0] == "status_confidence")
        self.assertEqual(conf_call[3],
                         {"status_vote": os.path.join(out_dir, "status_vote.parquet")})

    def test_only_runs_the_selected_subset_plus_its_deps(self):
        calls = []
        reg = _fake_registry(calls)
        with tempfile.TemporaryDirectory() as out_dir:
            targets = os.path.join(out_dir, "targets.parquet")
            open(targets, "w").close()
            bg.run(targets, out_dir, only=["name_polish"], registry=reg,
                   log=lambda _l: None)
        self.assertEqual([c[0] for c in calls], ["name_ar", "name_polish"])

    def test_never_writes_to_the_targets_file(self):
        calls = []
        reg = _fake_registry(calls)
        with tempfile.TemporaryDirectory() as out_dir:
            targets = os.path.join(out_dir, "targets.parquet")
            with open(targets, "w") as fh:
                fh.write("ORIGINAL")
            bg.run(targets, out_dir, registry=reg, log=lambda _l: None)
            with open(targets) as fh:
                self.assertEqual(fh.read(), "ORIGINAL")

    def test_missing_targets_is_refused_on_a_real_run(self):
        reg = _fake_registry([])
        with tempfile.TemporaryDirectory() as out_dir:
            with self.assertRaises(bg.PlanError):
                bg.run(os.path.join(out_dir, "absent.parquet"), out_dir,
                       registry=reg, log=lambda _l: None)

    def test_a_failing_step_stops_the_run_and_names_the_step(self):
        calls = []
        reg = _fake_registry(calls)

        def boom(base, out_path, dep_outputs, temp_dir):
            raise RuntimeError("kaboom")

        reg["hours_canonical"].run = boom
        with tempfile.TemporaryDirectory() as out_dir:
            targets = os.path.join(out_dir, "targets.parquet")
            open(targets, "w").close()
            with self.assertRaises(bg.StepFailed) as ctx:
                bg.run(targets, out_dir, registry=reg, log=lambda _l: None)
        self.assertEqual(ctx.exception.step_name, "hours_canonical")
        # hours_salvage depends on the failed step, so it must never have run.
        self.assertNotIn("hours_salvage", [c[0] for c in calls])


class TestCli(unittest.TestCase):
    def test_main_dry_run_returns_zero(self):
        with tempfile.TemporaryDirectory() as out_dir:
            rc = bg.main(["--targets", "/base/targets.parquet",
                          "--out-dir", out_dir, "--dry-run"])
        self.assertEqual(rc, 0)

    def test_main_unknown_step_returns_two(self):
        with tempfile.TemporaryDirectory() as out_dir:
            rc = bg.main(["--targets", "/base/targets.parquet",
                          "--out-dir", out_dir, "--only", "nope", "--dry-run"])
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
