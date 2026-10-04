"""Execute the resolved plan, retaining independent work after failures."""

from . import adapters
from .resources import pnpm, preflight

BATCH_ORDER = ("python", "vitest:unit", "vitest:integration", "vitest:coverage", "playwright")


def batches(steps, coverage=False):
    """One runner invocation per adapter and configuration, in a fixed order."""
    groups = {}
    for step in steps:
        key = step["adapter"]
        if key == "vitest":
            key = "vitest:coverage" if coverage else f"vitest:{step['layer']}"
        groups.setdefault(key, []).append(step)
    return [(key, groups[key]) for key in BATCH_ORDER if key in groups]


def build(resources, report, env, args):
    report.emit("Building the production app")
    resources.command([*pnpm(resources.root), "build"], env=env, timeout=args.timeout, idle=600,
                      log=report.directory / "build.log", emit=report.emit, stream=True)


def execute(plan, resources, report, args, lookup):
    outcomes = {}
    built, build_error = False, None
    for environment in plan["environments"]:
        platform = environment["platform"]
        directory = report.directory / platform
        directory.mkdir()
        report.emit(f"Preparing {platform}")
        cancelled = False
        steps = environment["steps"]
        try:
            memory = getattr(args, "database", "postgres") == "memory"
            if memory:
                # Tests that need PostgreSQL itself are reported, not run, against the in-memory database.
                for step in [s for s in steps if s.get("postgres")]:
                    report.result(step["test"], "not-run", platform, step["role"], key=step["key"],
                                  detail=f"Needs PostgreSQL: {step['postgres']}")
                    outcomes[step["key"]] = "not-run"
                steps = [s for s in steps if not s.get("postgres")]
            preflight(resources.root, docker=environment["database"] and not memory, browser=environment["build"])
            env = resources.test_env(platform, args.timezone)
            if environment["database"]:
                if memory:
                    resources.memory_database(platform, env, directory / "database.log")
                else:
                    resources.database(platform, env)
                resources.migrate(env, log=directory / "migrate.log")
            if environment["build"]:
                env.update(CI="1", FAMILYFI_MODE="test", PLAYWRIGHT_PORT=str(resources.port(platform)),
                           CLOUDFLARED_BIN=str(resources.root / "tests/fixtures/cloudflared/cloudflared"))
                if build_error:
                    raise RuntimeError(build_error)
                if not built:
                    try:
                        build(resources, report, env, args)
                    except Exception as error:
                        build_error = f"Production build failed: {error}"
                        raise RuntimeError(build_error) from error
                    built = True
            for index, (key, group) in enumerate(batches(steps, environment["coverage"])):
                batch_dir = directory / f"{index + 1:02}-{key.replace(':', '-')}"
                batch_dir.mkdir()
                report.emit(f"{platform}: running {len(group)} {key} tests")
                try:
                    floors = None
                    if key == "python":
                        actual, error = adapters.python(resources, report, group, batch_dir, env, args)
                    elif key == "playwright":
                        actual, error = adapters.playwright(resources, report, group, batch_dir, env, args,
                                                            lookup, platform)
                    else:
                        coverage = report.directory / "coverage" if key == "vitest:coverage" else None
                        actual, error, floors = adapters.vitest(resources, report, group, batch_dir, env, args,
                                                                lookup, coverage)
                    for step in group:
                        row = dict(actual[step["test"]])
                        status = row.pop("status"); row.pop("test")
                        report.result(step["test"], status, platform, step["role"], key=step["key"], **row)
                        outcomes[step["key"]] = status
                    if floors is not None:
                        report.result("coverage floors", "failed" if floors else "passed", platform, "check",
                                      detail=floors or "tests/vitest.coverage.config.ts thresholds met")
                    if error:
                        report.result(f"{platform}/{key}", "infrastructure-error", platform, "infrastructure",
                                      detail=error)
                except Exception as error:
                    for step in group:
                        if step["key"] not in outcomes:
                            report.result(step["test"], "infrastructure-error", platform, step["role"],
                                          key=step["key"], detail=str(error))
                            outcomes[step["key"]] = "infrastructure-error"
        except KeyboardInterrupt:
            cancelled = True
            raise
        except Exception as error:
            report.result(f"{platform}/setup", "infrastructure-error", platform, "infrastructure", detail=str(error))
        finally:
            for step in steps:
                if step["key"] not in outcomes:
                    report.result(step["test"], "cancelled" if cancelled else "blocked", platform, step["role"],
                                  key=step["key"], detail="Invocation cancelled" if cancelled
                                  else "Environment or build did not complete")
                    outcomes[step["key"]] = "blocked"
            try:
                resources.cleanup(platform)
            except Exception as error:
                report.result(f"{platform}/cleanup", "infrastructure-error", platform, "infrastructure",
                              detail=str(error))
    return outcomes
