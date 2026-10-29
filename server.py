#!/usr/bin/env python3
"""CET-4 离线备考平台 —— 纯标准库后端 (http.server + sqlite3)。

模块：单词 SRS / 听写 / 听力 / 口语 / 模拟卷 / 打卡统计 / 题库导入导出。
所有数据保存在同目录 data/cet4.db，可离线使用。
"""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

APP_VERSION = "1.0.0"
BASE = Path(__file__).resolve().parent
WEB = BASE / "web"
DATA = BASE / "data"
SEED = BASE / "seed"
VENDOR = BASE / "vendor"
DB_PATH = DATA / "cet4.db"
TTS_DIR = DATA / "tts"
START_TS = int(time.time())

DEFAULT_SETTINGS = {
    "daily_new": 20,
    "daily_review": 60,
    "accent": "en-us",
    "speed": 145,
}

ESPEAK = VENDOR / "usr/bin/espeak-ng"
ESPEAK_DATA = VENDOR / "usr/share/espeak-ng-data"
ESPEAK_LIB = VENDOR / "usr/lib"
FFMPEG = shutil.which("ffmpeg")

VOICES = {
    "M": "en-us+m3",
    "W": "en-us+f3",
}

_lock = threading.Lock()


def now() -> int:
    return int(time.time())


def today() -> str:
    return date.today().isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS words(
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phonetic TEXT DEFAULT '',
  pos TEXT DEFAULT '',
  meaning TEXT DEFAULT '',
  example TEXT DEFAULT '',
  example_cn TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  source TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS word_state(
  word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
  stage INTEGER DEFAULT 0,
  ease REAL DEFAULT 2.5,
  interval_days REAL DEFAULT 0,
  due_ts INTEGER DEFAULT 0,
  reps INTEGER DEFAULT 0,
  lapses INTEGER DEFAULT 0,
  last_ts INTEGER DEFAULT 0,
  first_ts INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0,
  wrong_count INTEGER DEFAULT 0,
  right_streak INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS word_logs(
  id INTEGER PRIMARY KEY,
  word_id INTEGER,
  mode TEXT DEFAULT 'study',
  rating INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS dictations(
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  translation TEXT DEFAULT '',
  hint TEXT DEFAULT '',
  source TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS dictation_logs(
  id INTEGER PRIMARY KEY,
  item_id INTEGER,
  answer TEXT DEFAULT '',
  accuracy REAL DEFAULT 0,
  correct INTEGER DEFAULT 0,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS listening(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  level TEXT DEFAULT 'CET-4',
  intro TEXT DEFAULT '',
  turns TEXT DEFAULT '[]',
  translation TEXT DEFAULT '',
  questions TEXT DEFAULT '[]',
  source TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS listening_logs(
  id INTEGER PRIMARY KEY,
  item_id INTEGER,
  answers TEXT DEFAULT '{}',
  score INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS speaking(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'topic',
  prompt TEXT DEFAULT '',
  tips TEXT DEFAULT '',
  sample TEXT DEFAULT '',
  seconds INTEGER DEFAULT 60,
  source TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS speaking_logs(
  id INTEGER PRIMARY KEY,
  item_id INTEGER,
  rating INTEGER DEFAULT 3,
  seconds INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS papers(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'mock',
  duration_sec INTEGER DEFAULT 7800,
  intro TEXT DEFAULT '',
  sections TEXT DEFAULT '[]',
  source TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS paper_logs(
  id INTEGER PRIMARY KEY,
  paper_id INTEGER,
  answers TEXT DEFAULT '{}',
  self_scores TEXT DEFAULT '{}',
  score REAL DEFAULT 0,
  total REAL DEFAULT 0,
  duration INTEGER DEFAULT 0,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS checkins(
  day TEXT PRIMARY KEY,
  words INTEGER DEFAULT 0,
  dictation INTEGER DEFAULT 0,
  listening INTEGER DEFAULT 0,
  speaking INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
"""


def load_json(name: str, default):
    p = SEED / name
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[seed] 读取 {name} 失败: {exc}", file=sys.stderr)
        return default


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT v FROM kv WHERE k='settings'").fetchone()
    data = {}
    if row:
        try:
            data = json.loads(row["v"])
        except Exception:
            data = {}
    if default is None:
        default = DEFAULT_SETTINGS.get(key)
    return data.get(key, default)


def all_settings(conn) -> dict:
    cfg = dict(DEFAULT_SETTINGS)
    row = conn.execute("SELECT v FROM kv WHERE k='settings'").fetchone()
    if row:
        try:
            cfg.update(json.loads(row["v"]))
        except Exception:
            pass
    return cfg


def save_settings(conn, updates: dict) -> dict:
    cfg = all_settings(conn)
    for k in DEFAULT_SETTINGS:
        if k in updates:
            try:
                cfg[k] = int(updates[k]) if k in ("daily_new", "daily_review", "speed") else str(updates[k])
            except Exception:
                pass
    cfg["daily_new"] = max(0, min(200, cfg["daily_new"]))
    cfg["daily_review"] = max(0, min(500, cfg["daily_review"]))
    cfg["speed"] = max(80, min(220, cfg["speed"]))
    conn.execute(
        "INSERT INTO kv(k,v) VALUES('settings',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (json.dumps(cfg, ensure_ascii=False),),
    )
    conn.commit()
    return cfg


def seed_if_empty(conn):
    if conn.execute("SELECT COUNT(*) c FROM words").fetchone()["c"] == 0:
        words = load_json("words.json", [])
        rows = []
        ts = now()
        for w in words:
            rows.append(
                (
                    w.get("word", "").strip(),
                    w.get("phonetic", ""),
                    w.get("pos", ""),
                    w.get("meaning", ""),
                    w.get("example", ""),
                    w.get("example_cn", ""),
                    w.get("tags", ""),
                    w.get("source", "CET-4 词表（来自用户自有 MIT 开源词库）"),
                    ts,
                )
            )
        rows = [r for r in rows if r[0]]
        conn.executemany(
            "INSERT OR IGNORE INTO words(word,phonetic,pos,meaning,example,example_cn,tags,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            rows,
        )
        print(f"[seed] 导入单词 {len(rows)} 条")

    if conn.execute("SELECT COUNT(*) c FROM dictations").fetchone()["c"] == 0:
        items = load_json("dictations.json", [])
        conn.executemany(
            "INSERT INTO dictations(text,translation,hint,source,created_at) VALUES(?,?,?,?,?)",
            [(i["text"], i.get("translation", ""), i.get("hint", ""), i.get("source", "原创听写句"), now()) for i in items],
        )
    if conn.execute("SELECT COUNT(*) c FROM listening").fetchone()["c"] == 0:
        items = load_json("listening.json", [])
        conn.executemany(
            "INSERT INTO listening(title,level,intro,turns,translation,questions,source,created_at) VALUES(?,?,?,?,?,?,?,?)",
            [
                (
                    i["title"],
                    i.get("level", "CET-4"),
                    i.get("intro", ""),
                    json.dumps(i.get("turns", []), ensure_ascii=False),
                    i.get("translation", ""),
                    json.dumps(i.get("questions", []), ensure_ascii=False),
                    i.get("source", "原创听力材料"),
                    now(),
                )
                for i in items
            ],
        )
    if conn.execute("SELECT COUNT(*) c FROM speaking").fetchone()["c"] == 0:
        items = load_json("speaking.json", [])
        conn.executemany(
            "INSERT INTO speaking(title,kind,prompt,tips,sample,seconds,source,created_at) VALUES(?,?,?,?,?,?,?,?)",
            [
                (
                    i["title"],
                    i.get("kind", "topic"),
                    i.get("prompt", ""),
                    i.get("tips", ""),
                    i.get("sample", ""),
                    int(i.get("seconds", 60)),
                    i.get("source", "原创口语题"),
                    now(),
                )
                for i in items
            ],
        )
    if conn.execute("SELECT COUNT(*) c FROM papers").fetchone()["c"] == 0:
        p = load_json("paper_mock.json", None)
        if p:
            conn.execute(
                "INSERT INTO papers(title,kind,duration_sec,intro,sections,source,created_at) VALUES(?,?,?,?,?,?,?)",
                (
                    p["title"],
                    p.get("kind", "mock"),
                    int(p.get("duration_sec", 7800)),
                    p.get("intro", ""),
                    json.dumps(p.get("sections", []), ensure_ascii=False),
                    p.get("source", "原创模拟卷"),
                    now(),
                ),
            )
    conn.commit()


def init_db():
    DATA.mkdir(parents=True, exist_ok=True)
    TTS_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    conn.executescript(SCHEMA)
    seed_if_empty(conn)
    conn.close()


# ---------------------------------------------------------------- TTS

def _espeak_env():
    env = dict(os.environ)
    env["LD_LIBRARY_PATH"] = str(ESPEAK_LIB) + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
    env["ESPEAK_DATA_PATH"] = str(ESPEAK_DATA)
    return env


def espeak_available() -> bool:
    return ESPEAK.exists() and ESPEAK_DATA.exists()


def synth(text: str, voice: str, speed: int) -> Path | None:
    key = hashlib.sha1(f"{voice}|{speed}|{text}".encode("utf-8")).hexdigest()[:20]
    out = TTS_DIR / f"{key}.wav"
    if out.exists() and out.stat().st_size > 100:
        return out
    if not espeak_available():
        return None
    tmp = TTS_DIR / f"{key}.tmp.wav"
    try:
        subprocess.run(
            [str(ESPEAK), "-v", voice, "-s", str(speed), "-w", str(tmp), text],
            env=_espeak_env(),
            check=True,
            timeout=60,
            capture_output=True,
        )
        tmp.replace(out)
        return out
    except Exception as exc:
        print(f"[tts] 合成失败: {exc}", file=sys.stderr)
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        return None


def synth_turns(turns: list[dict], speed: int) -> Path | None:
    """多角色对话：逐句合成后拼接。"""
    key = hashlib.sha1(
        ("turns|" + str(speed) + "|" + json.dumps(turns, ensure_ascii=False)).encode("utf-8")
    ).hexdigest()[:20]
    out = TTS_DIR / f"{key}.wav"
    if out.exists() and out.stat().st_size > 100:
        return out
    parts = []
    for idx, turn in enumerate(turns):
        text = (turn.get("text") or "").strip()
        if not text:
            continue
        p = synth(text, VOICES.get(turn.get("s", "M"), "en-us"), speed)
        if p is None:
            return None
        parts.append(p)
    if not parts:
        return None
    if len(parts) == 1:
        shutil.copyfile(parts[0], out)
        return out
    if not FFMPEG:
        return parts[0]
    tmp = TTS_DIR / f"{key}.list"
    with open(tmp, "w", encoding="utf-8") as fh:
        for p in parts:
            fh.write(f"file '{p}'\n")
    try:
        subprocess.run(
            [FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(tmp), "-ar", "22050", "-ac", "1", "-c:a", "pcm_s16le", str(out)],
            check=True,
            timeout=120,
            capture_output=True,
        )
        return out
    except Exception as exc:
        print(f"[tts] 拼接失败: {exc}", file=sys.stderr)
        return parts[0]
    finally:
        tmp.unlink(missing_ok=True)


def wav_response(handler, path: Path):
    data = path.read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", "audio/wav")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "public, max-age=86400")
    handler.send_header("Accept-Ranges", "none")
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(data)


# ---------------------------------------------------------------- helpers

def rowdict(row) -> dict:
    return {k: row[k] for k in row.keys()}


def normalize_word(s: str) -> str:
    return re.sub(r"[^a-z0-9\-']", "", (s or "").strip().lower())


def parse_day(ts: int) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def streak_info(conn):
    days = {r["day"] for r in conn.execute("SELECT day FROM checkins").fetchall()}
    streak = 0
    d = date.today()
    if d.isoformat() not in days:
        d -= timedelta(days=1)
    while d.isoformat() in days:
        streak += 1
        d -= timedelta(days=1)
    return streak, days


def activity_counts(conn, day: str) -> dict:
    start = int(datetime.strptime(day, "%Y-%m-%d").timestamp())
    end = start + 86400
    words = conn.execute(
        "SELECT COUNT(DISTINCT word_id) c FROM word_logs WHERE ts>=? AND ts<?", (start, end)
    ).fetchone()["c"]
    reviews = conn.execute("SELECT COUNT(*) c FROM word_logs WHERE ts>=? AND ts<?", (start, end)).fetchone()["c"]
    dictation = conn.execute("SELECT COUNT(*) c FROM dictation_logs WHERE ts>=? AND ts<?", (start, end)).fetchone()["c"]
    listening = conn.execute("SELECT COUNT(*) c FROM listening_logs WHERE ts>=? AND ts<?", (start, end)).fetchone()["c"]
    speaking = conn.execute("SELECT COUNT(*) c FROM speaking_logs WHERE ts>=? AND ts<?", (start, end)).fetchone()["c"]
    return {"words": words, "reviews": reviews, "dictation": dictation, "listening": listening, "speaking": speaking}


def touch_checkin(conn, day: str):
    conn.execute("INSERT OR IGNORE INTO checkins(day,ts) VALUES(?,?)", (day, now()))


def word_state_for(conn, wid: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM word_state WHERE word_id=?", (wid,)).fetchone()


def ensure_state(conn, wid: int):
    conn.execute(
        "INSERT OR IGNORE INTO word_state(word_id, first_ts) VALUES(?,?)", (wid, now())
    )


def apply_review(conn, wid: int, rating: int, mode: str) -> dict:
    """rating: 0 忘记 / 1 模糊 / 2 认识 / 3 太简单。"""
    ensure_state(conn, wid)
    st = word_state_for(conn, wid)
    ease = st["ease"] or 2.5
    interval = st["interval_days"] or 0
    stage = st["stage"] or 0
    reps = st["reps"] or 0
    lapses = st["lapses"] or 0
    ts = now()
    if rating <= 0:
        interval = 0.007  # 10 分钟后
        lapses += 1
        stage = max(0, stage - 1)
    elif rating == 1:
        interval = max(0.5, interval * 1.2) if interval else 0.5
    elif rating == 2:
        interval = 1 if interval < 1 else interval * ease
        stage += 1
    else:
        ease = min(3.2, ease + 0.08)
        interval = (1 if interval < 1 else interval * ease * 1.3)
        stage += 1
    interval = min(interval, 365)
    due = ts + int(interval * 86400)
    if interval < 0.02:
        due = ts + 600
    conn.execute(
        """UPDATE word_state SET ease=?, interval_days=?, due_ts=?, reps=?, lapses=?, stage=?,
           last_ts=?, first_ts=COALESCE(NULLIF(first_ts,0),?), favorite=favorite WHERE word_id=?""",
        (ease, interval, due, reps + 1, lapses, stage, ts, ts, wid),
    )
    conn.execute(
        "INSERT INTO word_logs(word_id,mode,rating,correct,ts) VALUES(?,?,?,?,?)",
        (wid, mode, rating, 1 if rating >= 2 else 0, ts),
    )
    if rating <= 0:
        conn.execute("UPDATE word_state SET wrong_count=wrong_count+1, right_streak=0 WHERE word_id=?", (wid,))
    else:
        conn.execute("UPDATE word_state SET right_streak=right_streak+1 WHERE word_id=?", (wid,))
    touch_checkin(conn, today())
    conn.commit()
    st = word_state_for(conn, wid)
    return rowdict(st)


# ---------------------------------------------------------------- handlers

class Api:
    def __init__(self, handler, conn):
        self.h = handler
        self.conn = conn

    def send(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.h.send_response(status)
        self.h.send_header("Content-Type", "application/json; charset=utf-8")
        self.h.send_header("Content-Length", str(len(body)))
        self.h.send_header("Cache-Control", "no-store")
        self.h.end_headers()
        if self.h.command != "HEAD":
            self.h.wfile.write(body)

    # ---- meta
    def meta(self):
        conn = self.conn
        cfg = all_settings(conn)
        total = conn.execute("SELECT COUNT(*) c FROM words").fetchone()["c"]
        learned = conn.execute("SELECT COUNT(*) c FROM word_state WHERE reps>0").fetchone()["c"]
        mastered = conn.execute("SELECT COUNT(*) c FROM word_state WHERE interval_days>=21").fetchone()["c"]
        due = conn.execute(
            "SELECT COUNT(*) c FROM word_state WHERE reps>0 AND due_ts<=?", (now(),)
        ).fetchone()["c"]
        today_new = conn.execute(
            "SELECT COUNT(DISTINCT word_id) c FROM word_logs WHERE mode='study' AND ts>=?",
            (int(datetime.strptime(today(), "%Y-%m-%d").timestamp()),),
        ).fetchone()["c"]
        streak, _ = streak_info(conn)
        day_counts = activity_counts(conn, today())
        listening = conn.execute("SELECT COUNT(*) c FROM listening").fetchone()["c"]
        dictations = conn.execute("SELECT COUNT(*) c FROM dictations").fetchone()["c"]
        speaking = conn.execute("SELECT COUNT(*) c FROM speaking").fetchone()["c"]
        papers = conn.execute("SELECT COUNT(*) c FROM papers").fetchone()["c"]
        checked = conn.execute("SELECT 1 FROM checkins WHERE day=?", (today(),)).fetchone() is not None
        self.send(
            {
                "ok": True,
                "version": APP_VERSION,
                "date": today(),
                "tts": espeak_available(),
                "settings": cfg,
                "words": {
                    "total": total,
                    "learned": learned,
                    "mastered": mastered,
                    "due": due,
                    "new_today": today_new,
                    "new_remaining": max(0, cfg["daily_new"] - today_new),
                },
                "today": day_counts,
                "streak": streak,
                "checked_in": checked,
                "counts": {
                    "listening": listening,
                    "dictation": dictations,
                    "speaking": speaking,
                    "papers": papers,
                },
            }
        )

    def settings_get(self):
        self.send({"ok": True, "settings": all_settings(self.conn)})

    def settings_post(self, body):
        cfg = save_settings(self.conn, body or {})
        self.send({"ok": True, "settings": cfg})

    # ---- words
    def words(self, qs):
        conn = self.conn
        mode = (qs.get("mode", ["all"])[0] or "all").strip()
        limit = max(1, min(200, int(qs.get("limit", ["30"])[0])))
        offset = max(0, int(qs.get("offset", ["0"])[0]))
        search = (qs.get("q", [""])[0] or "").strip()
        base = (
            "FROM words w LEFT JOIN word_state s ON s.word_id=w.id "
        )
        where = []
        params = []
        order = "ORDER BY w.id"
        if mode == "new":
            where.append("(s.word_id IS NULL OR s.reps=0)")
            order = "ORDER BY w.id"
        elif mode == "review":
            where.append("s.reps>0 AND s.due_ts<=?")
            params.append(now())
            order = "ORDER BY s.due_ts"
        elif mode == "wrong":
            where.append("s.wrong_count>0")
            order = "ORDER BY s.wrong_count DESC, w.id"
        elif mode == "favorite":
            where.append("s.favorite=1")
            order = "ORDER BY s.last_ts DESC"
        elif mode == "learned":
            where.append("s.reps>0")
            order = "ORDER BY s.last_ts DESC"
        if search:
            where.append("(w.word LIKE ? OR w.meaning LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])
        sql_where = ("WHERE " + " AND ".join(where)) if where else ""
        total = conn.execute(f"SELECT COUNT(*) c {base} {sql_where}", params).fetchone()["c"]
        rows = conn.execute(
            f"""SELECT w.*, s.stage,s.ease,s.interval_days,s.due_ts,s.reps,s.lapses,
                       s.favorite,s.wrong_count,s.right_streak,s.last_ts
                {base} {sql_where} {order} LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()
        items = []
        for r in rows:
            items.append(
                {
                    "id": r["id"],
                    "word": r["word"],
                    "phonetic": r["phonetic"],
                    "pos": r["pos"],
                    "meaning": r["meaning"],
                    "example": r["example"],
                    "example_cn": r["example_cn"],
                    "favorite": bool(r["favorite"]),
                    "stage": r["stage"] or 0,
                    "interval": r["interval_days"] or 0,
                    "due": r["due_ts"] or 0,
                    "reps": r["reps"] or 0,
                    "wrong": r["wrong_count"] or 0,
                    "mastered": (r["interval_days"] or 0) >= 21,
                }
            )
        self.send({"ok": True, "mode": mode, "total": total, "items": items})

    def word_review(self, body):
        wid = int(body.get("id", 0))
        rating = int(body.get("rating", 2))
        mode = body.get("mode", "study")
        if not self.conn.execute("SELECT 1 FROM words WHERE id=?", (wid,)).fetchone():
            return self.send({"ok": False, "error": "单词不存在"}, 404)
        st = apply_review(self.conn, wid, rating, mode)
        self.send({"ok": True, "state": st})

    def word_spell(self, body):
        wid = int(body.get("id", 0))
        answer = body.get("answer", "")
        row = self.conn.execute("SELECT word FROM words WHERE id=?", (wid,)).fetchone()
        if not row:
            return self.send({"ok": False, "error": "单词不存在"}, 404)
        correct = normalize_word(answer) == normalize_word(row["word"])
        st = apply_review(self.conn, wid, 2 if correct else 0, "spell")
        self.send({"ok": True, "correct": correct, "word": row["word"], "state": st})

    def word_favorite(self, body):
        wid = int(body.get("id", 0))
        ensure_state(self.conn, wid)
        cur = word_state_for(self.conn, wid)
        val = 0 if cur["favorite"] else 1
        self.conn.execute("UPDATE word_state SET favorite=? WHERE word_id=?", (val, wid))
        self.conn.commit()
        self.send({"ok": True, "favorite": bool(val)})

    # ---- dictation
    def dictation_list(self, qs):
        limit = max(1, min(100, int(qs.get("limit", ["20"])[0])))
        rows = self.conn.execute(
            """SELECT d.id,d.hint,d.source,
                      (SELECT COUNT(*) FROM dictation_logs l WHERE l.item_id=d.id) attempts,
                      (SELECT MAX(accuracy) FROM dictation_logs l WHERE l.item_id=d.id) best,
                      (SELECT correct FROM dictation_logs l WHERE l.item_id=d.id ORDER BY id DESC LIMIT 1) last_correct,
                      (SELECT COUNT(*) FROM dictation_logs l WHERE l.item_id=d.id AND correct=1) ok_count
               FROM dictations d ORDER BY d.id LIMIT ?""",
            (limit,),
        ).fetchall()
        self.send({"ok": True, "items": [rowdict(r) for r in rows]})

    def dictation_answer(self, body):
        item_id = int(body.get("id", 0))
        answer = (body.get("answer", "") or "").strip()
        row = self.conn.execute("SELECT * FROM dictations WHERE id=?", (item_id,)).fetchone()
        if not row:
            return self.send({"ok": False, "error": "听写条目不存在"}, 404)
        import difflib

        target = row["text"]
        a = re.findall(r"[A-Za-z']+", answer.lower())
        b = re.findall(r"[A-Za-z']+", target.lower())
        sm = difflib.SequenceMatcher(None, a, b)
        accuracy = round(sm.ratio() * 100, 1)
        correct = accuracy >= 90
        ops = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                for w in a[i1:i2]:
                    ops.append({"op": "ok", "word": w})
            elif tag == "replace":
                for k in range(max(i2 - i1, j2 - j1)):
                    got = a[i1 + k] if i1 + k < i2 else ""
                    want = b[j1 + k] if j1 + k < j2 else ""
                    ops.append({"op": "bad", "got": got, "word": want})
            elif tag == "delete":
                for w in a[i1:i2]:
                    ops.append({"op": "extra", "got": w})
            elif tag == "insert":
                for w in b[j1:j2]:
                    ops.append({"op": "miss", "word": w})
        self.conn.execute(
            "INSERT INTO dictation_logs(item_id,answer,accuracy,correct,ts) VALUES(?,?,?,?,?)",
            (item_id, answer, accuracy, 1 if correct else 0, now()),
        )
        touch_checkin(self.conn, today())
        self.conn.commit()
        self.send(
            {
                "ok": True,
                "correct": correct,
                "accuracy": accuracy,
                "text": target,
                "translation": row["translation"],
                "diff": ops,
            }
        )

    # ---- listening
    def listening_list(self):
        rows = self.conn.execute(
            """SELECT l.id,l.title,l.level,l.intro,
                      (SELECT COUNT(*) FROM listening_logs g WHERE g.item_id=l.id) attempts,
                      (SELECT MAX(score*100.0/NULLIF(total,0)) FROM listening_logs g WHERE g.item_id=l.id) best
               FROM listening l ORDER BY l.id"""
        ).fetchall()
        self.send({"ok": True, "items": [rowdict(r) for r in rows]})

    def listening_one(self, item_id: int):
        row = self.conn.execute("SELECT * FROM listening WHERE id=?", (item_id,)).fetchone()
        if not row:
            return self.send({"ok": False, "error": "听力材料不存在"}, 404)
        qs = json.loads(row["questions"] or "[]")
        public = [
            {
                "id": i,
                "q": q.get("q", ""),
                "options": q.get("options", []),
            }
            for i, q in enumerate(qs)
        ]
        self.send(
            {
                "ok": True,
                "id": row["id"],
                "title": row["title"],
                "level": row["level"],
                "intro": row["intro"],
                "questions": public,
                "audio": f"/api/audio/listening/{row['id']}",
            }
        )

    def listening_submit(self, body):
        item_id = int(body.get("id", 0))
        answers = body.get("answers", {}) or {}
        row = self.conn.execute("SELECT * FROM listening WHERE id=?", (item_id,)).fetchone()
        if not row:
            return self.send({"ok": False, "error": "听力材料不存在"}, 404)
        qs = json.loads(row["questions"] or "[]")
        details = []
        score = 0
        for i, q in enumerate(qs):
            got = str(answers.get(str(i), answers.get(i, ""))).strip().upper()
            want = str(q.get("answer", "")).strip().upper()
            ok = got == want
            score += 1 if ok else 0
            details.append(
                {
                    "index": i,
                    "correct": ok,
                    "answer": want,
                    "your": got,
                    "explanation": q.get("explanation", ""),
                }
            )
        self.conn.execute(
            "INSERT INTO listening_logs(item_id,answers,score,total,ts) VALUES(?,?,?,?,?)",
            (item_id, json.dumps(answers, ensure_ascii=False), score, len(qs), now()),
        )
        touch_checkin(self.conn, today())
        self.conn.commit()
        self.send(
            {
                "ok": True,
                "score": score,
                "total": len(qs),
                "details": details,
                "script": "\n".join(f"{t.get('s','')}: {t.get('text','')}" for t in json.loads(row["turns"] or "[]")),
                "translation": row["translation"],
            }
        )

    # ---- speaking
    def speaking_list(self):
        rows = self.conn.execute(
            """SELECT s.*, (SELECT COUNT(*) FROM speaking_logs g WHERE g.item_id=s.id) attempts,
                      (SELECT MAX(rating) FROM speaking_logs g WHERE g.item_id=s.id) best
               FROM speaking s ORDER BY s.id"""
        ).fetchall()
        self.send({"ok": True, "items": [rowdict(r) for r in rows]})

    def speaking_log(self, body):
        item_id = int(body.get("id", 0))
        rating = max(1, min(5, int(body.get("rating", 3))))
        seconds = max(0, min(3600, int(body.get("seconds", 0))))
        note = (body.get("note", "") or "")[:500]
        self.conn.execute(
            "INSERT INTO speaking_logs(item_id,rating,seconds,note,ts) VALUES(?,?,?,?,?)",
            (item_id, rating, seconds, note, now()),
        )
        touch_checkin(self.conn, today())
        self.conn.commit()
        self.send({"ok": True})

    # ---- papers
    def paper_list(self):
        rows = self.conn.execute(
            """SELECT p.id,p.title,p.kind,p.duration_sec,p.intro,p.source,
                      (SELECT COUNT(*) FROM paper_logs g WHERE g.paper_id=p.id) attempts,
                      (SELECT MAX(score) FROM paper_logs g WHERE g.paper_id=p.id) best
               FROM papers p ORDER BY p.id"""
        ).fetchall()
        self.send({"ok": True, "items": [rowdict(r) for r in rows]})

    def paper_one(self, pid: int):
        row = self.conn.execute("SELECT * FROM papers WHERE id=?", (pid,)).fetchone()
        if not row:
            return self.send({"ok": False, "error": "试卷不存在"}, 404)
        sections = json.loads(row["sections"] or "[]")
        out = []
        for si, sec in enumerate(sections):
            questions = []
            for qi, q in enumerate(sec.get("questions", [])):
                questions.append(
                    {
                        "id": f"{si}-{qi}",
                        "type": q.get("type", "single"),
                        "stem": q.get("stem", ""),
                        "options": q.get("options", []),
                        "answer_len": len(str(q.get("answer", ""))),
                    }
                )
            out.append(
                {
                    "title": sec.get("title", ""),
                    "type": sec.get("type", "reading"),
                    "intro": sec.get("intro", ""),
                    "passage": sec.get("passage", ""),
                    "audio": f"/api/audio/paper/{pid}/{si}" if (sec.get("audio_text") or sec.get("turns")) else None,
                    "prompt": sec.get("prompt", ""),
                    "self_score": sec.get("self_score", 0),
                    "questions": questions,
                }
            )
        self.send(
            {
                "ok": True,
                "id": row["id"],
                "title": row["title"],
                "kind": row["kind"],
                "duration_sec": row["duration_sec"],
                "intro": row["intro"],
                "sections": out,
            }
        )

    def paper_submit(self, body):
        pid = int(body.get("id", 0))
        answers = body.get("answers", {}) or {}
        self_scores = body.get("self_scores", {}) or {}
        duration = int(body.get("duration", 0))
        row = self.conn.execute("SELECT * FROM papers WHERE id=?", (pid,)).fetchone()
        if not row:
            return self.send({"ok": False, "error": "试卷不存在"}, 404)
        sections = json.loads(row["sections"] or "[]")
        total = 0.0
        score = 0.0
        details = []
        for si, sec in enumerate(sections):
            sec_total = 0.0
            sec_score = 0.0
            for qi, q in enumerate(sec.get("questions", [])):
                qid = f"{si}-{qi}"
                pts = float(q.get("score", 2))
                sec_total += pts
                got = str(answers.get(qid, "")).strip()
                want = str(q.get("answer", "")).strip()
                ok = False
                if q.get("type", "single") == "single":
                    ok = got.upper() == want.upper()
                else:
                    ok = normalize_word(got) == normalize_word(want)
                if ok:
                    sec_score += pts
                details.append(
                    {
                        "id": qid,
                        "correct": ok,
                        "answer": want,
                        "your": got,
                        "score": pts if ok else 0,
                        "explanation": q.get("explanation", ""),
                    }
                )
            self_total = float(sec.get("self_score", 0) or 0)
            self_got = 0.0
            if self_total:
                try:
                    self_got = max(0.0, min(self_total, float(self_scores.get(str(si), 0) or 0)))
                except Exception:
                    self_got = 0.0
                sec_total += self_total
                sec_score += self_got
            total += sec_total
            score += sec_score
            details.append(
                {
                    "id": f"{si}-self",
                    "type": "self",
                    "section": sec.get("title", ""),
                    "self_total": self_total,
                    "self_score": self_got,
                }
            )
        self.conn.execute(
            "INSERT INTO paper_logs(paper_id,answers,self_scores,score,total,duration,ts) VALUES(?,?,?,?,?,?,?)",
            (
                pid,
                json.dumps(answers, ensure_ascii=False),
                json.dumps(self_scores, ensure_ascii=False),
                score,
                total,
                duration,
                now(),
            ),
        )
        touch_checkin(self.conn, today())
        self.conn.commit()
        meta = []
        for si, sec in enumerate(sections):
            meta.append(
                {
                    "title": sec.get("title", ""),
                    "type": sec.get("type", ""),
                    "prompt": sec.get("prompt", ""),
                    "passage": sec.get("passage", "") if sec.get("type") == "reading" else "",
                    "sample": sec.get("sample", ""),
                    "self_total": float(sec.get("self_score", 0) or 0),
                }
            )
        self.send({"ok": True, "score": score, "total": total, "details": details, "sections": meta})

    # ---- checkin / stats
    def checkin(self, body):
        day = today()
        self.conn.execute("INSERT OR IGNORE INTO checkins(day,ts) VALUES(?,?)", (day, now()))
        if body and body.get("note"):
            self.conn.execute("UPDATE checkins SET note=? WHERE day=?", (str(body["note"])[:200], day))
        self.conn.commit()
        streak, days = streak_info(self.conn)
        self.send({"ok": True, "day": day, "streak": streak, "checked_in": True})

    def stats(self):
        conn = self.conn
        days = []
        for i in range(27, -1, -1):
            d = (date.today() - timedelta(days=i)).isoformat()
            c = activity_counts(conn, d)
            days.append({"date": d, **c})
        streak, checked = streak_info(conn)
        calendar = []
        for i in range(55, -1, -1):
            d = (date.today() - timedelta(days=i)).isoformat()
            calendar.append({"date": d, "checked": d in checked})
        total_logs = conn.execute("SELECT COUNT(*) c FROM word_logs").fetchone()["c"]
        correct_logs = conn.execute("SELECT COUNT(*) c FROM word_logs WHERE correct=1").fetchone()["c"]
        dict_total = conn.execute("SELECT COUNT(*) c FROM dictation_logs").fetchone()["c"]
        dict_ok = conn.execute("SELECT COUNT(*) c FROM dictation_logs WHERE correct=1").fetchone()["c"]
        listen_total = conn.execute("SELECT SUM(total) s FROM listening_logs").fetchone()["s"] or 0
        listen_score = conn.execute("SELECT SUM(score) s FROM listening_logs").fetchone()["s"] or 0
        paper_rows = conn.execute("SELECT score,total,ts FROM paper_logs ORDER BY id DESC LIMIT 5").fetchall()
        by_state = conn.execute(
            "SELECT CASE WHEN interval_days>=21 THEN 'mastered' WHEN reps>0 THEN 'learning' ELSE 'new' END k, COUNT(*) c FROM words w LEFT JOIN word_state s ON s.word_id=w.id GROUP BY k"
        ).fetchall()
        self.send(
            {
                "ok": True,
                "days": days,
                "calendar": calendar,
                "streak": streak,
                "word_accuracy": round(correct_logs * 100.0 / total_logs, 1) if total_logs else 0,
                "dictation": {"total": dict_total, "correct": dict_ok,
                              "accuracy": round(dict_ok * 100.0 / dict_total, 1) if dict_total else 0},
                "listening": {"total": listen_total, "score": listen_score,
                              "accuracy": round(listen_score * 100.0 / listen_total, 1) if listen_total else 0},
                "papers": [rowdict(r) for r in paper_rows],
                "words_by_state": {r["k"]: r["c"] for r in by_state},
                "totals": {
                    "word_reviews": total_logs,
                    "dictation": dict_total,
                },
            }
        )

    # ---- import / export
    def import_data(self, body):
        kind = body.get("kind", "words")
        fmt = body.get("format", "json")
        content = body.get("content", "")
        try:
            if fmt == "json":
                data = json.loads(content)
            else:
                import csv, io

                data = list(csv.DictReader(io.StringIO(content)))
        except Exception as exc:
            return self.send({"ok": False, "error": f"解析失败：{exc}"}, 400)
        if isinstance(data, dict):
            data = data.get("items") or data.get("words") or data.get("questions") or []
        imported = 0
        skipped = 0
        errors = []
        if kind == "words":
            for i, item in enumerate(data):
                try:
                    w = (item.get("word") or item.get("en") or item.get("单词") or "").strip()
                    if not w:
                        raise ValueError("缺少 word")
                    meaning = item.get("meaning") or item.get("cn") or item.get("释义") or ""
                    cur = self.conn.execute("SELECT id FROM words WHERE word=?", (w,)).fetchone()
                    if cur:
                        self.conn.execute(
                            "UPDATE words SET meaning=?,pos=?,example=?,example_cn=? WHERE id=?",
                            (meaning, item.get("pos", ""), item.get("example", ""), item.get("example_cn", ""), cur["id"]),
                        )
                        skipped += 1
                    else:
                        self.conn.execute(
                            "INSERT INTO words(word,phonetic,pos,meaning,example,example_cn,source,created_at) VALUES(?,?,?,?,?,?,?,?)",
                            (w, item.get("phonetic", ""), item.get("pos", ""), meaning,
                             item.get("example", ""), item.get("example_cn", ""),
                             item.get("source", "导入词库"), now()),
                        )
                        imported += 1
                except Exception as exc:
                    errors.append(f"第 {i+1} 条：{exc}")
        elif kind == "dictation":
            for i, item in enumerate(data):
                try:
                    text = (item.get("text") or item.get("句子") or "").strip()
                    if not text:
                        raise ValueError("缺少 text")
                    self.conn.execute(
                        "INSERT INTO dictations(text,translation,hint,source,created_at) VALUES(?,?,?,?,?)",
                        (text, item.get("translation", ""), item.get("hint", ""), item.get("source", "导入"), now()),
                    )
                    imported += 1
                except Exception as exc:
                    errors.append(f"第 {i+1} 条：{exc}")
        elif kind == "listening":
            for i, item in enumerate(data):
                try:
                    self.conn.execute(
                        "INSERT INTO listening(title,level,intro,turns,translation,questions,source,created_at) VALUES(?,?,?,?,?,?,?,?)",
                        (
                            item["title"], item.get("level", "CET-4"), item.get("intro", ""),
                            json.dumps(item.get("turns", []), ensure_ascii=False),
                            item.get("translation", ""),
                            json.dumps(item.get("questions", []), ensure_ascii=False),
                            item.get("source", "导入"), now(),
                        ),
                    )
                    imported += 1
                except Exception as exc:
                    errors.append(f"第 {i+1} 条：{exc}")
        elif kind == "paper":
            for i, item in enumerate(data):
                try:
                    self.conn.execute(
                        "INSERT INTO papers(title,kind,duration_sec,intro,sections,source,created_at) VALUES(?,?,?,?,?,?,?)",
                        (
                            item["title"], item.get("kind", "imported"),
                            int(item.get("duration_sec", 7800)), item.get("intro", ""),
                            json.dumps(item.get("sections", []), ensure_ascii=False),
                            item.get("source", "导入"), now(),
                        ),
                    )
                    imported += 1
                except Exception as exc:
                    errors.append(f"第 {i+1} 条：{exc}")
        else:
            return self.send({"ok": False, "error": "未知导入类型"}, 400)
        self.conn.commit()
        self.send({"ok": True, "imported": imported, "skipped": skipped, "errors": errors[:20]})

    def export(self, qs):
        kind = qs.get("kind", ["all"])[0]
        out = {}
        if kind in ("all", "words"):
            out["words"] = [
                {k: r[k] for k in ("word", "phonetic", "pos", "meaning", "example", "example_cn")}
                for r in self.conn.execute("SELECT * FROM words ORDER BY id")
            ]
        if kind in ("all", "stats"):
            out["stats"] = {
                "word_logs": self.conn.execute("SELECT COUNT(*) c FROM word_logs").fetchone()["c"],
                "checkins": [rowdict(r) for r in self.conn.execute("SELECT * FROM checkins ORDER BY day")],
            }
        self.send({"ok": True, "exported_at": datetime.now().isoformat(timespec="seconds"), "data": out})

    def tts(self, qs):
        text = (qs.get("text", [""])[0] or "").strip()
        voice = qs.get("voice", ["en-us"])[0]
        speed = int(qs.get("speed", [str(get_setting(self.conn, "speed", 145))])[0])
        if not text:
            return self.send({"ok": False, "error": "缺少 text"}, 400)
        if len(text) > 600:
            text = text[:600]
        p = synth(text, voice, speed)
        if not p:
            return self.send({"ok": False, "error": "语音引擎不可用"}, 503)
        wav_response(self.h, p)


# ---------------------------------------------------------------- server

class Handler(BaseHTTPRequestHandler):
    server_version = "CET4Study/" + APP_VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            return
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b"{}"
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return None

    def _static(self, path: str):
        rel = unquote(path.split("?", 1)[0])
        if rel in ("", "/"):
            rel = "/index.html"
        target = (WEB / rel.lstrip("/")).resolve()
        try:
            target.relative_to(WEB.resolve())
        except ValueError:
            return self._not_found()
        if not target.is_file():
            if "." not in target.name:
                target = WEB / "index.html"
            else:
                return self._not_found()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".js":
            ctype = "text/javascript; charset=utf-8"
        elif target.suffix in (".html", ".css"):
            ctype += "; charset=utf-8"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _not_found(self, msg="404 Not Found"):
        body = json.dumps({"ok": False, "error": msg}, ensure_ascii=False).encode()
        self.send_response(404)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        try:
            if not path.startswith("/api/"):
                return self._static(path)
            if path == "/api/health":
                return self._send_json({"ok": True, "version": APP_VERSION, "tts": espeak_available(), "ts": now()})
            conn = connect()
            try:
                api = Api(self, conn)
                if path == "/api/meta":
                    return api.meta()
                if path == "/api/settings":
                    return api.settings_get()
                if path == "/api/words":
                    return api.words(qs)
                if path == "/api/dictation":
                    return api.dictation_list(qs)
                if path == "/api/listening":
                    return api.listening_list()
                if path.startswith("/api/listening/"):
                    return api.listening_one(int(path.rsplit("/", 1)[1]))
                if path == "/api/speaking":
                    return api.speaking_list()
                if path == "/api/papers":
                    return api.paper_list()
                if path.startswith("/api/papers/"):
                    return api.paper_one(int(path.rsplit("/", 1)[1]))
                if path == "/api/stats":
                    return api.stats()
                if path == "/api/export":
                    return api.export(qs)
                if path == "/api/tts":
                    return api.tts(qs)
                if path == "/api/audio/word":
                    word = (qs.get("word", [""])[0] or "").strip()
                    accent = qs.get("accent", ["en-us"])[0]
                    speed = int(qs.get("speed", ["115"])[0])
                    p = synth(word, accent if accent in ("en-us", "en-gb") else "en-us", speed)
                    return wav_response(self, p) if p else self._not_found("语音引擎不可用")
                if path.startswith("/api/audio/dictation/"):
                    did = int(path.rsplit("/", 1)[1])
                    row = conn.execute("SELECT text FROM dictations WHERE id=?", (did,)).fetchone()
                    if not row:
                        return self._not_found()
                    slow = qs.get("slow", ["0"])[0] == "1"
                    p = synth(row["text"], "en-us", 105 if slow else 135)
                    return wav_response(self, p) if p else self._not_found("语音引擎不可用")
                if path.startswith("/api/audio/listening/"):
                    lid = int(path.rsplit("/", 1)[1])
                    row = conn.execute("SELECT turns FROM listening WHERE id=?", (lid,)).fetchone()
                    if not row:
                        return self._not_found()
                    turns = json.loads(row["turns"] or "[]")
                    p = synth_turns(turns, 140)
                    return wav_response(self, p) if p else self._not_found("语音引擎不可用")
                if path.startswith("/api/audio/paper/"):
                    parts = path.strip("/").split("/")
                    pid, si = int(parts[3]), int(parts[4])
                    row = conn.execute("SELECT sections FROM papers WHERE id=?", (pid,)).fetchone()
                    if not row:
                        return self._not_found()
                    sections = json.loads(row["sections"] or "[]")
                    if si >= len(sections) or not (sections[si].get("audio_text") or sections[si].get("turns")):
                        return self._not_found()
                    turns = sections[si].get("turns") or [
                        {"s": "M", "text": t} for t in sections[si]["audio_text"]
                    ]
                    p = synth_turns(turns, 140)
                    return wav_response(self, p) if p else self._not_found("语音引擎不可用")
            finally:
                conn.close()
            self._not_found()
        except BrokenPipeError:
            pass
        except Exception as exc:
            import traceback

            traceback.print_exc()
            try:
                self._send_json({"ok": False, "error": str(exc)}, 500)
            except Exception:
                pass

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _api(self):
        return Api(self, connect())

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._json_body()
        if body is None:
            return self._send_json({"ok": False, "error": "请求体不是合法 JSON"}, 400)
        conn = connect()
        try:
            api = Api(self, conn)
            routes = {
                "/api/settings": lambda: api.settings_post(body),
                "/api/word/review": lambda: api.word_review(body),
                "/api/word/spell": lambda: api.word_spell(body),
                "/api/word/favorite": lambda: api.word_favorite(body),
                "/api/dictation/answer": lambda: api.dictation_answer(body),
                "/api/listening/submit": lambda: api.listening_submit(body),
                "/api/speaking/log": lambda: api.speaking_log(body),
                "/api/papers/submit": lambda: api.paper_submit(body),
                "/api/checkin": lambda: api.checkin(body),
                "/api/import": lambda: api.import_data(body),
            }
            if path in routes:
                return routes[path]()
            self._not_found()
        except Exception as exc:
            import traceback

            traceback.print_exc()
            try:
                self._send_json({"ok": False, "error": str(exc)}, 500)
            except Exception:
                pass
        finally:
            conn.close()


def find_port(host: str, start: int, tries: int = 40) -> int:
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise SystemExit(f"没有可用端口（{start}-{start+tries-1}）")


def main():
    import argparse

    ap = argparse.ArgumentParser(description="CET-4 离线备考平台")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("CET4_PORT", "8766")))
    ap.add_argument("--open", action="store_true", help="启动后打开浏览器")
    args = ap.parse_args()
    init_db()
    port = find_port(args.host, args.port)
    (DATA / "server.url").write_text(f"http://{args.host}:{port}\n")
    httpd = ThreadingHTTPServer((args.host, port), Handler)
    httpd.daemon_threads = True
    url = f"http://{args.host}:{port}"
    print(f"CET-4 备考平台已启动：{url}")
    print(f"数据目录：{DATA}")
    if args.open:
        import webbrowser

        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
