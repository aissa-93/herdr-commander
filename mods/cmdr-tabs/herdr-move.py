#!/usr/bin/env python3
"""Move panes between tabs in the Herdr app, keeping their terminals running.

  herdr-move.py tab  <pane>                       the pane's terminal into a new tab, right after its own
  herdr-move.py join <tab> <pane> [right|down]    every terminal of <tab> beside <pane> (another tab):
                                                  the first one right (or below) of it, the rest stacked
                                                  below that one; the emptied tab closes

A move parks the terminal (its pane goes, it keeps running) and then keeps it
again where it should be. Mod panes (Files, notes) can't move: they stay put.
Run by the Commander mods (cmdr-pane, cmdr-tabs, cmdr-menubar) with exec, so the
move finishes even when the pane that asked for it is gone.
"""

import json
import subprocess
import sys
import time


def do(command, **args):
    argv = ["herdr-app", "do", command]
    for k, v in args.items():
        argv += [f"--{k}", v if isinstance(v, str) else json.dumps(v)]
    r = subprocess.run(argv, capture_output=True, text=True)
    try:
        out = json.loads(r.stdout or "{}")
    except json.JSONDecodeError:
        out = {"error": r.stdout.strip() or r.stderr.strip()}
    if r.returncode != 0 or "error" in out:
        raise SystemExit(f"{command}: {out.get('error', r.stderr.strip())}")
    return out


def world():
    r = subprocess.run(["herdr-app", "ls"], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)["spaces"]


def tabs():
    return [(s, t) for s in world() for t in s["tabs"]]


def find_pane(pane):
    for s, t in tabs():
        for x in t["terminals"]:
            if x.get("pane") == pane:
                return s, t, x
    return None, None, None


def find_tab(tab):
    return next(((s, t) for s, t in tabs() if t["id"] == tab), (None, None))


def wait(what, test, timeout=8.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if test():
            return
        time.sleep(0.1)
    raise SystemExit(f"timed out waiting for {what}")


def parked(terminal):
    """Out of every tab here, and the core has dropped its keep and Herdr labels."""
    def test():
        if any(x["terminal"] == terminal and x.get("pane") for _, t in tabs() for x in t["terminals"]):
            return False
        r = subprocess.run(["hc", "get", terminal], capture_output=True, text=True)
        try:
            core = json.loads(r.stdout)
        except json.JSONDecodeError:
            return False
        return not core.get("keep") and "herdr.tab" not in (core.get("labels") or {})
    return test


def keep(terminal, place, beside):
    """Keep a parked terminal next to `beside` (a pane): terminal.keep acts on the
    focused pane's space and tab, so focus it first. Waits for the new pane."""
    for attempt in range(10):
        do("pane.focus", pane=beside)
        try:
            made = do("terminal.keep", terminal=terminal, place=place)
            break
        except SystemExit:
            # The core may still be finishing the park; a terminal left without a
            # pane would keep running unseen, so try for a few seconds.
            if attempt == 9:
                raise
            time.sleep(0.3)
    new = made.get("pane")
    if new:
        wait(f"the pane of {terminal}", lambda: find_pane(new)[2] is not None)
    return made


def to_tab(pane):
    s, t, x = find_pane(pane)
    if not x:
        raise SystemExit(f"no terminal pane {pane}")
    others = [y["pane"] for y in t["terminals"] if y.get("pane") and y["pane"] != pane]
    if not others:
        raise SystemExit("it is the tab's only pane already")
    terminal = x["terminal"]
    index = next(i for i, c in enumerate(s["tabs"]) if c["id"] == t["id"]) + 2
    do("terminal.park", terminal=terminal)
    wait(f"{terminal} to leave its pane", parked(terminal))
    made = keep(terminal, "tab", others[0])
    new = made.get("tab")
    if new:
        # keep names the tab after the address; unnamed, a tab shows what runs in it.
        do("tab.rename", id=new, name="")
        do("tab.move", id=new, index=index)
        do("pane.focus", pane=made["pane"])
    print(json.dumps({"tab": new, "pane": made.get("pane"), "terminal": terminal}))


def join(tab, pane, direction="right"):
    s, source = find_tab(tab)
    if not source:
        raise SystemExit(f"no tab {tab}")
    _, target, _ = find_pane(pane)
    if not target:
        raise SystemExit(f"no terminal pane {pane}")
    if target["id"] == tab:
        raise SystemExit("that pane is in the same tab")
    moving = [x["terminal"] for x in source["terminals"] if x.get("pane")]
    if not moving:
        raise SystemExit("nothing to move: the tab has no terminal panes")
    for terminal in moving:
        do("terminal.park", terminal=terminal)
    for terminal in moving:
        wait(f"{terminal} to leave its pane", parked(terminal))
    # The first one beside the target, the rest stacked under it: the moved tab
    # becomes one new column (or row) next to the pane it joined.
    at, then = pane, "down" if direction == "right" else "right"
    panes = []
    for i, terminal in enumerate(moving):
        made = keep(terminal, direction if i == 0 else then, at)
        at = made.get("pane") or at
        panes.append(at)
    do("pane.focus", pane=panes[0])
    print(json.dumps({"tab": target["id"], "panes": panes, "moved": moving}))


def main(argv):
    if len(argv) >= 2 and argv[0] == "tab":
        return to_tab(argv[1])
    if len(argv) >= 3 and argv[0] == "join":
        direction = argv[3] if len(argv) > 3 else "right"
        if direction not in ("right", "down"):
            raise SystemExit("direction: right or down")
        return join(argv[1], argv[2], direction)
    raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
