"""Private unittest adapter, invoked in a bounded child process."""
import json
from pathlib import Path
import sys
import time
import unittest

SEP = " > "


def identity(test):
    module, cls, method = test.id().rsplit(".", 2)
    return SEP.join([f"scripts/tests/{module.replace('.', '/')}.py", cls, method])


def execute(identifiers, destination):
    class Result(unittest.TestResult):
        def startTest(self, test):
            super().startTest(test)
            self.started = time.monotonic()

        def record(self, test, status, detail=""):
            record = {"test": identity(test), "status": status, "detail": detail,
                      "seconds": round(time.monotonic() - getattr(self, "started", time.monotonic()), 3)}
            with destination.open("a") as handle:
                handle.write(json.dumps(record) + "\n")
            mark = "✓" if status in ("passed", "expected-failure") else "✗" if status == "failed" else "↓"
            print(f" {mark} {record['test']}", flush=True)

        def addSuccess(self, test):
            super().addSuccess(test)
            self.record(test, "passed")

        def addFailure(self, test, error):
            super().addFailure(test, error)
            self.record(test, "failed", self._exc_info_to_string(error, test))

        def addError(self, test, error):
            super().addError(test, error)
            self.record(test, "failed", self._exc_info_to_string(error, test))

        def addSkip(self, test, reason):
            super().addSkip(test, reason)
            self.record(test, "skipped", reason)

        def addExpectedFailure(self, test, error):
            super().addExpectedFailure(test, error)
            self.record(test, "expected-failure", self._exc_info_to_string(error, test))

        def addUnexpectedSuccess(self, test):
            super().addUnexpectedSuccess(test)
            self.record(test, "failed", "Unexpected success: remove the expected-failure marker")

        def addSubTest(self, test, subtest, error):
            super().addSubTest(test, subtest, error)
            if error:
                self.record(test, "failed", self._exc_info_to_string(error, test))

    names = []
    for name in identifiers:
        path, cls, method = name.split(SEP)
        module = Path(path).relative_to("scripts/tests").with_suffix("").as_posix().replace("/", ".")
        names.append(f"{module}.{cls}.{method}")
    suite = unittest.TestLoader().loadTestsFromNames(names)
    result = Result()
    suite.run(result)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "scripts"))
    sys.path.insert(0, str(root / "scripts/tests"))
    sys.exit(execute(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2])))
