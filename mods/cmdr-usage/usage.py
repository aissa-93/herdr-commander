# Tokens the coding agents on this machine used over the last 7 days, as JSON.
# Read from what they log themselves: Claude Code's ~/.claude/projects/**/*.jsonl and
# Codex's ~/.codex/sessions/**/*.jsonl. Nothing leaves the machine. Run by Commander's
# menu bar (python3 usage.py here, python3 -c on other machines); a file is read again
# only when it grew, the rest comes from ~/.cache/herdr-commander-usage.json.
#
# "Tokens" counts input, output and cache writes. Cache reads are reported apart
# (`cached`): they are most of the traffic and cost a tenth as much.
import json, os, sys, time
from datetime import datetime, timedelta

DAYS = 7
VERSION = 2
home = os.path.expanduser("~")
cache_path = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.join(home, ".cache"), "herdr-commander-usage.json")
now = datetime.now().astimezone()
days = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(DAYS - 1, -1, -1)]
first = days[0]
cutoff = time.time() - (DAYS + 1) * 86400


def local_day(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d")
    except Exception:
        return None


def n(v):
    return v if isinstance(v, int) else 0


# One entry per answer: [id, day, cwd, tool, model, input, output, cache write, cache read].
def claude(path):
    out = {}
    with open(path, errors="replace") as f:
        for line in f:
            if '"usage"' not in line or '"assistant"' not in line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("type") != "assistant":
                continue
            m = d.get("message") or {}
            u = m.get("usage")
            if not isinstance(u, dict) or m.get("model") == "<synthetic>":
                continue
            day = local_day(d.get("timestamp") or "")
            if not day or day < first:
                continue
            # An answer is logged once per piece of it, and again in a resumed session's file.
            key = "%s:%s" % (m.get("id") or d.get("uuid") or "", d.get("requestId") or "")
            out[key] = [key, day, d.get("cwd") or "", "claude", m.get("model") or "",
                        n(u.get("input_tokens")), n(u.get("output_tokens")),
                        n(u.get("cache_creation_input_tokens")), n(u.get("cache_read_input_tokens"))]
    return list(out.values()), None


def codex(path):
    out, cwd, model, prev, limit, count = [], "", "", None, None, 0
    name = os.path.basename(path)
    with open(path, errors="replace") as f:
        for line in f:
            head = line[:160]
            if '"session_meta"' in head or '"turn_context"' in head:
                try:
                    p = json.loads(line).get("payload") or {}
                except Exception:
                    continue
                cwd = p.get("cwd") or cwd
                model = p.get("model") or model
                continue
            if '"token_count"' not in line or '"event_msg"' not in head:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            p = d.get("payload") or {}
            if d.get("type") != "event_msg" or p.get("type") != "token_count":
                continue
            ts = d.get("timestamp") or ""
            if p.get("rate_limits") and (limit is None or ts > limit[0]):
                limit = [ts, p["rate_limits"]]
            info = p.get("info") or {}
            total, last = info.get("total_token_usage"), info.get("last_token_usage")
            if not total:
                continue
            # The running total says what this answer added; a session that carries on
            # from another starts with that one's total, so its first answer is `last`.
            keys = ("input_tokens", "cached_input_tokens", "output_tokens", "cache_write_input_tokens")
            if prev is not None and all(n(total.get(k)) >= n(prev.get(k)) for k in keys):
                use = {k: n(total.get(k)) - n(prev.get(k)) for k in keys}
            else:
                use = {k: n((last or {}).get(k)) for k in keys}
            prev = total
            if not any(use.values()):
                continue
            day = local_day(ts)
            if not day or day < first:
                continue
            count += 1
            out.append(["cx:%s:%d" % (name, count), day, cwd, "codex", model,
                        max(0, use["input_tokens"] - use["cached_input_tokens"] - use["cache_write_input_tokens"]),
                        use["output_tokens"], use["cache_write_input_tokens"], use["cached_input_tokens"]])
    return out, limit


def files(root):
    for base, _dirs, names in os.walk(root):
        for name in names:
            if name.endswith(".jsonl"):
                yield os.path.join(base, name)


try:
    with open(cache_path) as f:
        cache = json.load(f)
    if cache.get("version") != VERSION or cache.get("first") != first:
        cache = {}
except Exception:
    cache = {}
old = cache.get("files") or {}
kept = {}
for root, read in ((os.path.join(home, ".claude", "projects"), claude), (os.path.join(home, ".codex", "sessions"), codex)):
    for path in files(root):
        try:
            st = os.stat(path)
        except OSError:
            continue
        if st.st_mtime < cutoff:
            continue
        c = old.get(path)
        if c and c["m"] == st.st_mtime and c["s"] == st.st_size:
            kept[path] = c
            continue
        try:
            entries, limit = read(path)
        except Exception:
            continue
        kept[path] = {"m": st.st_mtime, "s": st.st_size, "e": entries, "l": limit}

try:
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    tmp = "%s.%d" % (cache_path, os.getpid())
    with open(tmp, "w") as f:
        json.dump({"version": VERSION, "first": first, "files": kept}, f, separators=(",", ":"))
    os.replace(tmp, cache_path)
except Exception:
    pass

today = days[-1]
index = {d: i for i, d in enumerate(days)}
daily = [0] * DAYS
places, tools = {}, {}
cached, output = [0, 0], [0, 0]
seen = set()
limit = None
for path in sorted(kept):
    c = kept[path]
    if c.get("l") and (limit is None or c["l"][0] > limit[0]):
        limit = c["l"]
    for key, day, cwd, tool, _model, inp, out, cw, cr in c["e"]:
        if key in seen or day not in index:
            continue
        seen.add(key)
        tok = inp + out + cw
        daily[index[day]] += tok
        for box, k in ((places, cwd), (tools, tool)):
            row = box.setdefault(k, [0, 0])
            row[1] += tok
            if day == today:
                row[0] += tok
        cached[1] += cr
        output[1] += out
        if day == today:
            cached[0] += cr
            output[0] += out

codex_limit = None
if limit:
    p = (limit[1] or {}).get("primary") or {}
    if p.get("used_percent") is not None:
        codex_limit = {"at": limit[0], "used": p.get("used_percent"), "minutes": p.get("window_minutes"),
                       "resets": p.get("resets_at"), "plan": (limit[1] or {}).get("plan_type")}

json.dump({"at": int(time.time() * 1000), "days": days, "daily": daily,
           "places": sorted(([k, v[0], v[1]] for k, v in places.items()), key=lambda r: -r[2])[:60],
           "tools": tools, "cached": cached, "output": output, "codex_limit": codex_limit},
          sys.stdout, separators=(",", ":"))
