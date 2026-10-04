"""Pure execution planning; prerequisites are visible and independently reported."""
from .catalog import select


def plan(tests, coverage=False, **filters):
    selected, platforms = select(tests, **filters)
    if coverage:
        vitest = {t["id"] for t in tests if t["adapter"] == "vitest"}
        if "host" not in platforms or not vitest <= {t["id"] for t in selected}:
            raise ValueError("--coverage measures the whole unit and integration suite against its floors: "
                             "select it with --platform host and no test, category or layer filter")
    environments = []
    for platform in platforms:
        applicable = {t["id"] for t in selected if platform in t["platforms"]}
        if not applicable:
            continue
        needed = set(applicable)
        # A serial test depends on every earlier test of its group on this platform.
        prerequisites = {}
        for test in tests:
            group = test.get("serial")
            if group and test["id"] in applicable:
                earlier = [t["id"] for t in tests if t.get("serial") == group and platform in t["platforms"]
                           and t["order"] < test["order"]]
                prerequisites[test["id"]] = earlier
                needed.update(earlier)
        steps, keys = [], {}
        for test in sorted((t for t in tests if t["id"] in needed), key=lambda t: t["order"]):
            key = f"{platform}:{len(steps) + 1}"
            keys[test["id"]] = key
            steps.append({"key": key, "test": test["id"], "adapter": test["adapter"], "layer": test["layer"],
                          "source": test["source"], "line": test["line"],
                          **({"postgres": test["postgres"]} if test.get("postgres") else {}),
                          "role": "selected" if test["id"] in applicable else "prerequisite",
                          "depends_on": [keys[name] for name in prerequisites.get(test["id"], [])]})
        environments.append({"platform": platform,
                             "database": any(s["layer"] in ("integration", "ui") for s in steps),
                             "build": any(s["layer"] == "ui" for s in steps),
                             "coverage": coverage and platform == "host",
                             "steps": steps})
    return {"version": 1, "environments": environments}
