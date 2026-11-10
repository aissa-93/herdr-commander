# Tokens the coding agents on this machine used over the last 7 days, as JSON.
# Read from what they log themselves: Claude Code's ~/.claude/projects/**/*.jsonl and
# Codex's ~/.codex/sessions/**/*.jsonl. Nothing leaves the machine. Run by Commander's
# menu bar (python3 usage.py here, python3 -c on other machines); a file is read again
# only when it grew, the rest comes from ~/.cache/herdr-commander-usage.json.
#
# "Tokens" counts input, output and cache writes. Cache reads are reported apart
# (`cached`): they are most of the traffic and cost a tenth as much or less.
#
# `cost` is what the same tokens would have cost at API list prices (PRICES below, in
# dollars per million tokens), whatever plan actually paid for them. Each answer is
# priced as logged: uncached input, output, cache writes (Claude's by TTL: 5 minutes
# at 1.25x input, 1 hour at 2x) and cache reads. Fast mode doubles Claude's rates.
# Not priced: long-context surcharges (but Haiku's over 100K), web search, batches.
# A model missing here counts as `unpriced` tokens rather than as zero dollars.
import json, os, sys, time
from datetime import datetime, timedelta

DAYS = 7
VERSION = 4

# $ per million tokens: input, output, short cache write, long cache write, cache
# read. Claude lifetimes are 5m/1h; OpenAI lifetimes are 30m/12h. The longest matching prefix of the logged model wins (Mythos prices as Fable).
# Claude: Anthropic's list prices (Nov 2026). OpenAI: its published prices, as reported
# Nov 2026. Codex logs no write TTL, so estimates assume the default 30m lifetime.
# Sources: https://platform.claude.com/docs/en/about-claude/pricing
# https://developers.openai.com/api/docs/pricing
PRICES = {
    "claude-fable-5-2": (8, 40, 10, 16, 0.20),
    "claude-fable-5-1": (10, 50, 12.5, 20, 0.25),
    "claude-fable-5": (10, 50, 12.5, 20, 1.00),
    "claude-opus-5-5": (4, 20, 5, 8, 0.20),
    "claude-opus-5": (5, 25, 6.25, 10, 0.50),
    "claude-opus-4-8": (5, 25, 6.25, 10, 0.50),
    "claude-opus-4-7": (5, 25, 6.25, 10, 0.50),
    "claude-opus-4-6": (5, 25, 6.25, 10, 0.50),
    "claude-opus-4-5": (5, 25, 6.25, 10, 0.50),
    "claude-opus-4": (15, 75, 18.75, 30, 1.50),
    "claude-sonnet-5-5": (2, 10, 2.5, 4, 0.10),
    "claude-sonnet-5": (2, 10, 2.5, 4, 0.20),
    "claude-sonnet-4": (3, 15, 3.75, 6, 0.30),
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.20, 0.01),
    "claude-haiku-4": (1, 5, 1.25, 2, 0.10),
    "gpt-6-astra": (10, 50, 12.5, 25, 1.00),
    "gpt-6.1-sol": (2, 10, 2.5, 5, 0.10),
    "gpt-6.1-terra": (1, 5, 1.25, 2.5, 0.05),
}


def price(model):
    m = (model or "").lower().replace("mythos", "fable")
    best = None
    for k in PRICES:
        if m.startswith(k) and (best is None or len(k) > len(best)):
            best = k
    return PRICES[best] if best else None


def cost(model, inp, out, cw5, cw1, cr, fast):
    p = price(model)
    if p is None:
        return None
    x = 2 if fast and model.startswith("claude") else 1
    # Haiku 5.5 charges 5x for prompts over 100K tokens.
    if model.startswith("claude-haiku-5-5") and inp + cw5 + cw1 + cr > 100000:
        x *= 5
    return x * (inp * p[0] + out * p[1] + cw5 * p[2] + cw1 * p[3] + cr * p[4]) / 1e6
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


# One entry per answer: [id, day, cwd, tool, model, input, output, cache write, cache read,
# of the cache write the part kept an hour, fast mode].
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
            cw = n(u.get("cache_creation_input_tokens"))
            split = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
            # Without the split, Claude Code's writes are hour-long ones.
            hour = min(cw, n(split.get("ephemeral_1h_input_tokens"))) if split else cw
            out[key] = [key, day, d.get("cwd") or "", "claude", m.get("model") or "",
                        n(u.get("input_tokens")), n(u.get("output_tokens")),
                        cw, n(u.get("cache_read_input_tokens")), hour, u.get("speed") == "fast"]
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
                        use["output_tokens"], use["cache_write_input_tokens"], use["cached_input_tokens"], 0, False])
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
spent, unpriced, daily_cost = [0.0, 0.0], [0, 0], [0.0] * DAYS
models = {}
seen = set()
limit = None
for path in sorted(kept):
    c = kept[path]
    if c.get("l") and (limit is None or c["l"][0] > limit[0]):
        limit = c["l"]
    for key, day, cwd, tool, model, inp, out, cw, cr, hour, fast in c["e"]:
        if key in seen or day not in index:
            continue
        seen.add(key)
        tok = inp + out + cw
        usd = cost(model, inp, out, cw - hour, hour, cr, fast)
        now_ = day == today
        daily[index[day]] += tok
        daily_cost[index[day]] += usd or 0
        # Rows: [today tokens, week tokens, today $, week $].
        for box, k in ((places, cwd), (tools, tool), (models, model or "?")):
            row = box.setdefault(k, [0, 0, 0.0, 0.0])
            row[1] += tok
            row[3] += usd or 0
            if now_:
                row[0] += tok
                row[2] += usd or 0
        if usd is None:
            unpriced[1] += tok + cr
            if now_:
                unpriced[0] += tok + cr
        else:
            spent[1] += usd
            if now_:
                spent[0] += usd
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
           "places": sorted(([k, v[0], v[1], round(v[2], 4), round(v[3], 4)] for k, v in places.items()), key=lambda r: -r[2]),
           "tools": tools, "cached": cached, "output": output, "codex_limit": codex_limit,
           "cost": spent, "daily_cost": [round(v, 4) for v in daily_cost], "unpriced": unpriced,
           "models": models},
          sys.stdout, separators=(",", ":"))
