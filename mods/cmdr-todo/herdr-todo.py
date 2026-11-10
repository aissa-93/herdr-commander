#!/usr/bin/env python3
"""herdr-todo: the to-do list of a Herdr space, shared by the person and every agent in it.

Each space has one list, a markdown file on the space's machine:
  ~/.herdr/todos/<space id>.md
    - [ ] still to do     - [/] being worked on (by whom)     - [x] done
Commander's To-do panel shows it; agents read and change it with this command. Run in a
Herdr terminal, it finds its own space (the terminal's herdr.space label); elsewhere,
say which with --space.

  herdr-todo                      show the list
  herdr-todo add "A" "B"          add lines (--start: and mark them yours)
  herdr-todo start <line>...      you are working on it
  herdr-todo done <line>...       finished
  herdr-todo reopen <line>...     not done after all
  herdr-todo rm <line>...         take a line out
  herdr-todo edit <line> "text"   reword a line
  herdr-todo clear-done           take the done lines out
  herdr-todo path                 where the file is
  herdr-todo hook                 for agents' hooks: tells a session about the list
                                  (SessionStart, UserPromptSubmit and Stop)
  herdr-todo install              make agents use it by themselves: puts this command in
                                  ~/.local/bin, that hook in Claude Code's and Codex's
                                  settings, and lets Claude Code run it without asking
                                  (--on <machine>: there, over hc)
  herdr-todo uninstall            take the hooks out again (--on <machine>: there)

<line> is its number in the list, or a part of its text that only it has.
Options: --space <id>, --name <space name>, --json (print the list as JSON),
--exact (a line is named by its whole text), --id (by its stable identity), --agent <terminal> --tab <tab> (who starts it).
"""
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import uuid

ROOT = os.path.expanduser("~/.herdr/todos")
STATE = os.path.expanduser("~/.herdr/todos-state")  # the lock, and what each terminal has seen
ITEM = re.compile(r"^\s*[-*] \[( |x|X|/)\] (.*?)(?: <!-- agent:(\S+) tab:(\S+) -->)?(?: <!-- id:([A-Za-z0-9_-]+) -->)?\s*$")
BOX = {"open": " ", "started": "/", "done": "x"}


def hc(*args):
    exe = shutil.which("hc") or os.path.expanduser("~/.local/bin/hc")
    try:
        r = subprocess.run([exe, *args, "--json"], capture_output=True, text=True, timeout=6)
        return json.loads(r.stdout) if r.returncode == 0 else None
    except Exception:
        return None


def here():
    """This terminal and the Herdr space it is in: a helper started by an agent has no
    pane of its own, so its space is its starter's."""
    me = os.environ.get("HC_TERMINAL_ID")
    if not me:
        return {}
    out = {"agent": me}
    at = me
    for _ in range(6):
        t = hc("get", at)
        if not t:
            break
        labels = t.get("labels") or {}
        if at == me:
            out["tab"] = labels.get("herdr.tab")
        if labels.get("herdr.space"):
            out["space"] = labels["herdr.space"]
            out["tab"] = out.get("tab") or labels.get("herdr.tab")
            out["name"] = (labels.get("where") or "").split(" / ")[0] or None
            break
        at = t.get("parent")
        if not at:
            break
    return out


def alive():
    """The addresses of the terminals that are running, or None when that can't be told."""
    out = hc("ls")
    if not out or "terminals" not in out:
        return None
    return {t.get("address") for t in out["terminals"] if t.get("state", "live") == "live"}


def label(space):
    """The name the person gave the space in Herdr's sidebar, if they did (this machine only)."""
    try:
        with open(os.path.expanduser("~/.config/herdr-app/shared.json")) as f:
            return (json.load(f).get("space.labels") or {}).get(space) or None
    except Exception:
        return None


def parse(text):
    """A file's lines: {state, text, agent, tab} for a to-do, {raw} for anything else."""
    out = []
    for line in (text or "").split("\n"):
        m = ITEM.match(line)
        if not m:
            out.append({"raw": line})
            continue
        state = "open" if m.group(1) == " " else "started" if m.group(1) == "/" else "done"
        out.append({"state": state, "text": m.group(2), "agent": m.group(3), "tab": m.group(4), "id": m.group(5) or uuid.uuid4().hex})
    return out


def render(entries):
    lines = []
    for e in entries:
        if "raw" in e:
            lines.append(e["raw"])
            continue
        who = " <!-- agent:%s tab:%s -->" % (e["agent"], e.get("tab") or "-") if e["state"] == "started" and e.get("agent") else ""
        lines.append("- [%s] %s%s <!-- id:%s -->" % (BOX[e["state"]], e["text"], who, e["id"]))
    return "\n".join(lines)


def items(entries):
    return [e for e in entries if "raw" not in e]


def pick(entries, sel, exact, by_id=False):
    """The line a selector names, or an error saying why not."""
    its = items(entries)
    if by_id:
        found = [e for e in its if e["id"] == sel]
        return (found[0], None) if len(found) == 1 else (None, "that to-do changed or was removed; refresh the list")
    if exact:
        found = [e for e in its if e["text"] == sel]
        if len(found) > 1:
            return None, '"%s" matches %d lines; use its number' % (sel, len(found))
        return (found[0], None) if found else (None, "no line reads exactly: %s" % sel)
    if sel.isdigit():
        n = int(sel)
        return (its[n - 1], None) if 1 <= n <= len(its) else (None, "there is no line %d" % n)
    low = sel.lower().strip()
    same = [e for e in its if e["text"].lower() == low]
    if len(same) == 1:
        return same[0], None
    if len(same) > 1:
        return None, '"%s" matches %d lines; use its number' % (sel, len(same))
    found = [e for e in its if low in e["text"].lower()]
    live = [e for e in found if e["state"] != "done"]
    if len(live) == 1:
        return live[0], None
    if len(found) == 1:
        return found[0], None
    if not found:
        return None, 'no line matches "%s"' % sel
    return None, '"%s" matches %d lines; use its number or more of its text' % (sel, len(found))


def show(entries, me, name, every=False, live=None):
    its = items(entries)
    head = "To-do list of this Herdr space%s (the user and the other agents here see it too):" % (' "%s"' % name if name else "")
    if not its:
        return head + "\n  (empty)"
    out = [head]
    hidden = 0
    for n, e in enumerate(its, 1):
        if e["state"] == "done" and not every:
            hidden += 1
            continue
        who = ""
        if e["state"] == "started" and e.get("agent"):
            if e["agent"] == me:
                who = "   <- in progress: you"
            elif live is not None and e["agent"] not in live:
                who = "   <- left unfinished by agent %s, which is gone: free to take over" % e["agent"]
            else:
                who = "   <- in progress: agent %s" % e["agent"]
        out.append("  %d. [%s] %s%s" % (n, BOX[e["state"]], e["text"], who))
    if hidden:
        out.append("  (%d done, not shown: herdr-todo list --all)" % hidden)
    return "\n".join(out)


MARK = "herdr-todo hook"  # how our hook entries are told from the others


def source():
    return open(os.path.realpath(__file__)).read() if "__file__" in globals() else None


def install(remove, on):
    """Adds (or removes) the hook in the agents' own settings. Never run by the panel:
    it changes how the person's agents behave, so the person runs it."""
    if on:
        src = source()
        hc_exe = shutil.which("hc") or os.path.expanduser("~/.local/bin/hc")
        there = 'python3 "$HOME/.local/bin/herdr-todo" %s' % ("uninstall" if remove else "install")
        if not remove:
            there = 'mkdir -p "$HOME/.local/bin" && cat > "$HOME/.local/bin/herdr-todo" && chmod +x "$HOME/.local/bin/herdr-todo" && ' + there
        r = subprocess.run([hc_exe, "exec", "--on", on, "-i", "sh", "-c", there], input="" if remove else src, text=True)
        return r.returncode
    exe = os.path.expanduser("~/.local/bin/herdr-todo")
    if not remove:
        me = os.path.realpath(__file__)
        if os.path.realpath(exe) != me:
            os.makedirs(os.path.dirname(exe), exist_ok=True)
            if os.path.lexists(exe):
                os.remove(exe)
            os.symlink(me, exe)
            print("linked %s -> %s" % (exe, me))
    command = "%s hook 2>/dev/null || true" % exe
    for tool, path in (("Claude Code", "~/.claude/settings.json"), ("Codex", "~/.codex/hooks.json")):
        path = os.path.expanduser(path)
        if not os.path.isdir(os.path.dirname(path)):
            print("%s: not set up here, skipped" % tool)
            continue
        try:
            with open(path) as f:
                before = f.read()
            data = json.loads(before)
        except FileNotFoundError:
            before, data = None, {}
        except ValueError as err:
            print("%s: %s isn't valid JSON (%s); left alone" % (tool, path, err))
            continue
        hooks = data.setdefault("hooks", {})
        for event in ("SessionStart", "UserPromptSubmit", "Stop"):
            groups = [g for g in hooks.get(event, []) if not any(MARK in (h.get("command") or "") for h in g.get("hooks", []))]
            if not remove:
                groups.append({"hooks": [{"type": "command", "command": command, "timeout": 10}]})
            if groups:
                hooks[event] = groups
            else:
                hooks.pop(event, None)
        if not hooks:
            data.pop("hooks", None)
        if tool == "Claude Code":
            # Without this every herdr-todo call would stop the agent on a permission prompt.
            rule = "Bash(herdr-todo:*)"
            perms = data.setdefault("permissions", {})
            allow = [r for r in perms.get("allow", []) if r != rule]
            if not remove:
                allow.append(rule)
            if allow:
                perms["allow"] = allow
            else:
                perms.pop("allow", None)
            if not perms:
                data.pop("permissions", None)
        after = json.dumps(data, indent=2) + "\n"
        if before is not None and json.loads(before) == data:
            print("%s: already %s" % (tool, "without it" if remove else "set up"))
            continue
        if before is not None:
            with open(path + ".before-herdr-todo", "w") as f:
                f.write(before)
        with open(path, "w") as f:
            f.write(after)
        print("%s: %s %s%s" % (tool, "removed from" if remove else "added to", path, "" if before is None else " (the file as it was: %s.before-herdr-todo)" % path))
    if not remove:
        print("New agent sessions in Herdr are told about their space's list from now on.")
        print("Codex asks you once to trust the new hook; sessions already running pick it up when restarted.")
    return 0


BRIEF = """You are running inside Herdr, in the space{name}. This space has a to-do list that the user watches in a side panel and that every agent working in the space shares. Keep it true as you work, without being asked:
- Before starting work that has more than one step, put every step on the list, one line each: {cmd} add "First step" "Second step". Lines are short and concrete; the user reads them. If a line already says what you were asked, use that line instead of adding a duplicate.
- When you begin a line: {cmd} start <number or part of its text>. The moment it is finished: {cmd} done <number or part of its text>. One at a time, as you go, never all at the end.
- A line marked [/] by another agent is theirs: leave it. One left unfinished by an agent that is gone is free: start it if it is part of what you were asked.
- Put follow-ups you notice but will not do now on the list too, so the user sees them. Do not remove or reword lines you did not add.
- When you stop, no line of yours stays [/] unless you are still in the middle of it.
- A quick answer or a single small change needs no line.
`{cmd}` alone shows the list."""


def main():
    args = sys.argv[1:]
    opt = {"json": False, "exact": False, "start": False, "all": False, "id": False}
    val = {"space": None, "name": None, "agent": None, "tab": None, "on": None}
    rest = []
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("--") and a[2:] in opt:
            opt[a[2:]] = True
        elif a.startswith("--") and a[2:] in val and i + 1 < len(args):
            val[a[2:]] = args[i + 1]
            i += 1
        elif a in ("-h", "--help"):
            print(__doc__.strip())
            return 0
        else:
            rest.append(a)
        i += 1
    cmd = rest[0] if rest else "list"
    params = rest[1:]

    if cmd in ("install", "uninstall"):
        return install(cmd == "uninstall", val["on"])

    hook_in = {}
    if cmd == "hook":
        try:
            hook_in = json.loads(sys.stdin.read() or "{}")
        except Exception:
            hook_in = {}
        # A subagent inside Claude Code is its parent's business.
        if hook_in.get("agent_id"):
            return 0

    ctx = {} if val["space"] and val["agent"] else here()
    space = val["space"] or ctx.get("space")
    me = val["agent"] or ctx.get("agent")
    tab = val["tab"] or ctx.get("tab")
    if not space:
        if cmd == "hook":
            return 0  # not in Herdr: nothing to say
        return fail(opt, "not in a Herdr space: run it in a Herdr terminal, or say --space <id>")
    space = re.sub(r"[^A-Za-z0-9_-]", "_", space.split("/")[-1])
    name = val["name"] or label(space) or ctx.get("name")
    path = os.path.join(ROOT, space + ".md")

    if cmd == "path":
        print(path)
        return 0

    os.makedirs(ROOT, exist_ok=True)
    os.makedirs(STATE, exist_ok=True)
    said = []
    with open(os.path.join(STATE, "lock"), "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with open(path) as f:
                before = f.read()
        except OSError:
            before = None
        entries = parse(before if before is not None else "# To-do%s\n\n" % (": " + name if name else ""))
        error = None

        def each(fn):
            nonlocal error
            if not params:
                error = "say which line: its number or part of its text"
            # All of them are found before any is changed: numbers mean the list as shown.
            found = []
            for sel in params:
                e, err = pick(entries, sel, opt["exact"], opt["id"])
                if err:
                    error = err
                    return
                if e not in found:
                    found.append(e)
            for e in found:
                fn(e)

        if cmd in ("list", "show", "json", "hook"):
            pass
        elif cmd == "add":
            if not params:
                error = "say what to add"
            for text in params:
                text = " ".join(text.split())
                if not text:
                    continue
                same = [e for e in items(entries) if e["state"] != "done" and e["text"].lower() == text.lower()]
                if same:
                    e = same[0]
                    said.append("already on the list: %s" % text)
                else:
                    e = {"state": "open", "text": text, "agent": None, "tab": None, "id": uuid.uuid4().hex}
                    # After the last to-do; in a file with none yet, before its final newline.
                    last = max((n for n, x in enumerate(entries) if "raw" not in x), default=None)
                    if last is not None:
                        at = last + 1
                    else:
                        at = len(entries) - 1 if entries and not entries[-1]["raw"].strip() else len(entries)
                    entries.insert(at, e)
                    if at == len(entries) - 1:
                        entries.append({"raw": ""})
                    said.append("added: %s" % text)
                if opt["start"] and me and not (e["state"] == "started" and e.get("agent") not in (None, me)):
                    e.update(state="started", agent=me, tab=tab)
        elif cmd == "start":
            def start(e):
                nonlocal error
                if e["state"] == "started" and e.get("agent") and me and e["agent"] != me and not (opt["exact"] or opt["id"]):
                    live = alive()
                    if live is None or e["agent"] in live:
                        error = "agent %s is already working on: %s" % (e["agent"], e["text"])
                        return
                e.update(state="started", agent=me, tab=tab)
                said.append("started: %s" % e["text"])
            each(start)
        elif cmd == "done":
            each(lambda e: (e.update(state="done", agent=None, tab=None), said.append("done: %s" % e["text"])))
        elif cmd == "reopen":
            each(lambda e: (e.update(state="open", agent=None, tab=None), said.append("open again: %s" % e["text"])))
        elif cmd == "rm":
            each(lambda e: (entries.remove(e), said.append("removed: %s" % e["text"])))
        elif cmd == "edit":
            if len(params) != 2 or not " ".join(params[1].split()):
                error = 'edit takes a line and its new text: herdr-todo edit 2 "New wording"'
            else:
                e, error = pick(entries, params[0], opt["exact"], opt["id"])
                if e:
                    e["text"] = " ".join(params[1].split())
                    said.append("now reads: %s" % e["text"])
        elif cmd == "clear-done":
            gone = [e for e in items(entries) if e["state"] == "done"]
            for e in gone:
                entries.remove(e)
            said.append("cleared %d done" % len(gone))
        else:
            error = "unknown command: %s (herdr-todo --help)" % cmd

        if error:
            return fail(opt, error, entries, path, space)
        after = render(entries)
        if after != before and (before is not None or items(entries)):
            tmp = "%s.%d" % (path, os.getpid())
            with open(tmp, "w") as f:
                f.write(after)
            os.replace(tmp, path)
        current = after if os.path.exists(path) else ""

    # What this terminal has seen of the list, so its hook only speaks of news.
    digest = hashlib.sha1(current.encode()).hexdigest()
    seen_path = os.path.join(STATE, "%s.%s.json" % (space, re.sub(r"[^A-Za-z0-9_-]", "_", me or "none")))
    try:
        with open(seen_path) as f:
            seen = json.load(f)
    except Exception:
        seen = {}

    def remember(session=None, read=True, **more):
        if not me:
            return
        seen.update(session=session or seen.get("session"), **more)
        if read:
            seen["hash"] = digest
        try:
            with open(seen_path, "w") as f:
                json.dump(seen, f)
        except OSError:
            pass

    others = any(e["state"] == "started" and e.get("agent") not in (None, me) for e in items(entries))
    live = alive() if others and cmd not in ("json",) and not opt["json"] else None

    if cmd == "hook":
        event = hook_in.get("hook_event_name") or "SessionStart"
        session = hook_in.get("session_id")
        if event == "SessionStart":
            # What long-gone terminals had seen isn't worth keeping.
            try:
                import time
                for f in os.listdir(STATE):
                    full = os.path.join(STATE, f)
                    if f.endswith(".json") and time.time() - os.path.getmtime(full) > 30 * 86400:
                        os.remove(full)
            except OSError:
                pass
        if event == "Stop":
            # An agent about to stop with lines still marked as in progress is asked once
            # (per set of lines) to make the list true: this is what keeps it from going stale.
            mine = [(n, e) for n, e in enumerate(items(entries), 1) if e["state"] == "started" and e.get("agent") == me]
            key = hashlib.sha1("\n".join(e["text"] for _, e in mine).encode()).hexdigest() if mine else None
            if not mine or hook_in.get("stop_hook_active") or seen.get("nudged") == key:
                return 0
            remember(session, read=False, nudged=key)
            lines = "\n".join("  %d. %s" % (n, e["text"]) for n, e in mine)
            print(json.dumps({"decision": "block", "reason": "The space's to-do list still shows these as in progress by you:\n%s\nMark the ones that are finished: herdr-todo done <number>. Leave any you are really still in the middle of (waiting for the user, say). Then stop, without commenting on this check." % lines}))
            return 0
        briefed = event != "SessionStart" and session and seen.get("session") == session
        if briefed and seen.get("hash") == digest:
            return 0
        call = "herdr-todo" if shutil.which("herdr-todo") or "__file__" not in globals() else "python3 %s" % os.path.realpath(__file__)
        if briefed:
            text = "The to-do list of this Herdr space changed since you last saw it.\n" + show(entries, me, name, live=live)
        else:
            text = BRIEF.format(name=' "%s"' % name if name else "", cmd=call)
            notes = os.path.expanduser("~/.config/herdr-app/notes/%s.md" % space)
            if os.path.exists(notes) and os.path.getsize(notes):
                text += "\nThe user's own notes for this space are in %s: read them when they bear on the work; do not edit them." % notes
            text += "\n\n" + show(entries, me, name, live=live)
        remember(session)
        print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}))
        return 0

    if cmd != "json" and not opt["json"]:
        remember()
    if opt["json"] or cmd == "json":
        print(json.dumps({"space": space, "path": path, "said": said, "items": items(entries)}))
    else:
        for line in said:
            print(line)
        print(show(entries, me, name, every=opt["all"], live=live))
    return 0


def fail(opt, message, entries=None, path=None, space=None):
    if opt["json"]:
        print(json.dumps({"error": message, "space": space, "path": path, "items": items(entries) if entries is not None else []}))
    else:
        print("herdr-todo: %s" % message, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
