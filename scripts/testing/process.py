"""Bounded subprocess groups. A timeout or partial result never becomes a pass."""
import os
from pathlib import Path
import queue
import signal
import subprocess
import threading
import time


class CommandError(RuntimeError):
    pass


def stop(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
    # Children can outlive the group leader.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run(command, *, cwd, env=None, timeout=600, idle=180, log=None, emit=None, stream=False,
        owner=None, check=True):
    """Run one command in its own process group.

    With `stream`, every output line goes to `emit`; otherwise `emit` gets a heartbeat every
    30 s. The whole output is returned and, with `log`, written as it arrives.
    """
    command = list(map(str, command))
    process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, start_new_session=True, bufsize=1)
    lines, output = queue.Queue(), []
    def read():
        try:
            for line in process.stdout:
                lines.put(line)
        finally:
            lines.put(None)
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    handle = None
    started = last = heartbeat = time.monotonic()
    ended = False
    try:
        handle = Path(log).open("a") if log else None
        if owner:
            owner.track_process(process)
        while not ended or process.poll() is None:
            now = time.monotonic()
            if now - started > timeout:
                raise CommandError(f"{Path(command[0]).name} hit the {timeout} s wall-clock timeout")
            if idle and now - last > idle:
                raise CommandError(f"{Path(command[0]).name}: no output for {idle} s")
            try:
                line = lines.get(timeout=0.1)
                if line is None:
                    ended = True
                else:
                    output.append(line)
                    last = time.monotonic()
                    if handle:
                        handle.write(line); handle.flush()
                    if emit and stream and line.strip():
                        emit(line.rstrip())
            except queue.Empty:
                pass
            if emit and not stream and now - heartbeat >= 30:
                emit(f"Running {Path(command[0]).name}: {int(now - started)} s elapsed")
                heartbeat = now
        code = process.wait(timeout=5)
        if check and code:
            tail = "".join(output[-12:])
            raise CommandError(f"{Path(command[0]).name} exited {code}\n{tail}")
        return code, "".join(output)
    finally:
        stop(process)
        reader.join(timeout=5)
        if not reader.is_alive():
            process.stdout.close()
        if owner:
            owner.untrack_process(process.pid)
        if handle:
            handle.close()
