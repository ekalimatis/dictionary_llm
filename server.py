import json
import os
import re
import sys
import time
import threading
import datetime
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORAGE_DIR = os.environ.get("WORD_STORE") or BASE_DIR
DATA_FILE = os.path.join(STORAGE_DIR, "data.json")
AUDIO_DIR = os.path.join(STORAGE_DIR, "audio")
LOG_DIR = os.path.join(STORAGE_DIR, "logs")
REQUEST_LOG = os.path.join(LOG_DIR, "requests.log")

_log_lock = threading.Lock()


def log_event(kind, fields=None):
    """Дописывает строку JSON в logs/requests.log."""
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        entry = {"ts": datetime.datetime.now().isoformat(timespec="seconds"), "kind": kind}
        if isinstance(fields, dict):
            entry.update(fields)
        line = json.dumps(entry, ensure_ascii=False)
        with _log_lock:
            with open(REQUEST_LOG, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception:
        pass


def short(text, limit=200):
    text = str(text or "").replace("\n", " ").strip()
    return text if len(text) <= limit else text[:limit] + "…"

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp3": "audio/mpeg",
}

FISH_TTS_URL = os.environ.get("FISH_TTS_URL") or "https://api.fish.audio/v1/tts"
FISH_API_KEY = os.environ.get("FISH_API_KEY") or "sk-fish-hPVpem6y9EmwDMbHPp9qdDXiU0L5EQuUNVuDOVrFiXM"
FISH_MODEL = os.environ.get("FISH_MODEL") or "s2.1-pro-free"
FISH_REFERENCE_ID = os.environ.get("FISH_REFERENCE_ID") or "711cf3ed00ab441a8f54a45058047b7a"


def norm(s):
    return " ".join(re.findall(r"[\w]+", str(s or "").lower()))


def tts_speech_text(lemma):
    """Текст для озвучки: без служебных скобок, напр. get to grips (with) → get to grips with."""
    s = re.sub(r"\([^)]*\)", "", str(lemma or "")).strip()
    return s or str(lemma or "").strip()


def fish_tts_bytes(text):
    t0 = time.time()
    try:
        payload = {
            "text": text,
            "reference_id": FISH_REFERENCE_ID,
            "format": "mp3",
        }
        headers = {
            "Authorization": "Bearer " + FISH_API_KEY,
            "Content-Type": "application/json",
            "model": FISH_MODEL,
        }
        req = urllib.request.Request(
            FISH_TTS_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=90) as resp:
            audio = resp.read()
        log_event("external_request", {
            "service": "fish.audio",
            "url": FISH_TTS_URL,
            "model": FISH_MODEL,
            "text": short(text),
            "ok": True,
            "duration_ms": int((time.time() - t0) * 1000),
            "bytes": len(audio),
        })
        return audio
    except Exception as e:
        log_event("external_request", {
            "service": "fish.audio",
            "url": FISH_TTS_URL,
            "model": FISH_MODEL,
            "text": short(text),
            "ok": False,
            "error": short(str(e), 300),
            "duration_ms": int((time.time() - t0) * 1000),
        })
        raise


def save_word_audio(word):
    """Генерирует mp3 для слова и сохраняет в audio/<id>.mp3.
    Возвращает dict {"path": ...} при успехе или {"error": ...}."""
    word_id = word.get("id")
    lemma = word.get("lemma")
    if not word_id or not lemma:
        log_event("word_audio", {"word_id": word_id, "lemma": short(lemma), "ok": False, "error": "нет id или lemma"})
        return {"error": "нет id или lemma"}
    try:
        os.makedirs(AUDIO_DIR, exist_ok=True)
        audio = fish_tts_bytes(tts_speech_text(lemma))
    except Exception as e:
        log_event("word_audio", {"word_id": word_id, "lemma": short(lemma), "ok": False, "error": short(str(e), 300)})
        return {"error": str(e)}
    rel = "audio/%s.mp3" % word_id
    full = os.path.join(BASE_DIR, rel)
    try:
        with open(full, "wb") as f:
            f.write(audio)
    except Exception as e:
        log_event("word_audio", {"word_id": word_id, "lemma": short(lemma), "ok": False, "error": short(str(e), 300)})
        return {"error": "не удалось записать файл: " + str(e)}
    log_event("word_audio", {"word_id": word_id, "lemma": short(lemma), "ok": True, "path": rel, "bytes": len(audio)})
    return {"path": rel}


def read_words():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except ValueError:
        return None


def write_words(words):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)
        f.write("\n")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_bytes(self, code, payload, ctype):
        try:
            p = urlparse(self.path).path
            if "/api/" in p or p.startswith("/audio/"):
                log_event("http", {
                    "method": self.command,
                    "path": p,
                    "status": code,
                    "peer": self.client_address[0] if self.client_address else "",
                })
        except Exception:
            pass
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_text(self, code, text, ctype):
        self._send_bytes(code, text.encode("utf-8"), ctype)

    def _send_json(self, code, obj):
        self._send_text(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            return None

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/words":
            words = read_words()
            if words is None:
                self._send_json(500, {"error": "data.json повреждён (не JSON)"})
                return
            self._send_json(200, words)
            return
        if path in ("/", ""):
            path = "/index.html"
        rel = path.lstrip("/")
        fpath = os.path.normpath(os.path.join(BASE_DIR, rel))
        if not fpath.startswith(BASE_DIR) or not os.path.isfile(fpath):
            self._send_text(404, "Not found", "text/plain; charset=utf-8")
            return
        ext = os.path.splitext(fpath)[1].lower()
        with open(fpath, "rb") as f:
            self._send_bytes(200, f.read(), MIME_TYPES.get(ext, "application/octet-stream"))

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/audio/lemma":
            self._handle_lemma_audio()
            return
        if path == "/api/audio/example":
            self._handle_example_audio()
            return
        if path != "/api/words":
            self._send_text(404, "Not found", "text/plain; charset=utf-8")
            return
        body = self._read_json()
        entry = body.get("entry") if isinstance(body, dict) else None
        if not isinstance(entry, dict):
            self._send_json(400, {"error": "Нужно передать {\"entry\": {...}}"})
            return
        lemma = str(entry.get("lemma") or "").strip()
        if not lemma:
            self._send_json(400, {"error": "Лемма обязательна"})
            return
        words = read_words()
        if words is None:
            self._send_json(500, {"error": "data.json повреждён (не JSON)"})
            return
        nlemma = norm(lemma)
        for w in words:
            if norm(w.get("lemma")) == nlemma:
                self._send_json(409, {"error": "Слово \"" + lemma + "\" уже есть в словаре (№" + str(w.get("id")) + ")"})
                return
        allowed = ("lemma", "original_form", "transcription", "part_of_speech", "translations", "examples", "phrases", "notes")
        clean = {k: entry[k] for k in allowed if k in entry}
        if "translations" not in clean or not isinstance(clean["translations"], list) or not clean["translations"]:
            self._send_json(400, {"error": "Нужен хотя бы один перевод (поле translations)"})
            return
        clean["id"] = (max([int(w.get("id") or 0) for w in words] or [0])) + 1
        tts_res = save_word_audio(clean)
        if "path" in tts_res:
            clean["audio"] = tts_res["path"]
        else:
            clean["tts_error"] = tts_res.get("error", "TTS недоступен")
        words.append(clean)
        write_words(words)
        log_event("word_add", {"id": clean["id"], "lemma": short(clean["lemma"]),
                                "audio": clean.get("audio"), "tts_error": clean.get("tts_error")})
        self._send_json(201, {"entry": clean})

    def _handle_lemma_audio(self):
        """Генерация/получение mp3 леммы: audio/<id>.mp3"""
        body = self._read_json()
        if not isinstance(body, dict):
            self._send_json(400, {"error": "Нужен id"})
            return
        try:
            word_id = int(body.get("id"))
        except (TypeError, ValueError):
            self._send_json(400, {"error": "Нужен целый id"})
            return
        words = read_words()
        if not words:
            self._send_json(500, {"error": "data.json повреждён"})
            return
        word = next((w for w in words if int(w.get("id") or 0) == word_id), None)
        if word is None:
            self._send_json(404, {"error": "Слово не найдено"})
            return
        try:
            os.makedirs(AUDIO_DIR, exist_ok=True)
        except OSError:
            pass
        rel = "audio/%s.mp3" % word_id
        full = os.path.join(BASE_DIR, rel)
        generated = False
        if not os.path.isfile(full):
            try:
                audio = fish_tts_bytes(tts_speech_text(word.get("lemma") or ""))
                with open(full, "wb") as f:
                    f.write(audio)
                generated = True
            except Exception as e:
                log_event("lemma_audio", {"word_id": word_id, "lemma": short(word.get("lemma")),
                                          "ok": False, "error": short(str(e), 300)})
                self._send_json(502, {"error": "TTS недоступен: " + str(e)})
                return
        word["audio"] = rel
        write_words(words)
        log_event("lemma_audio", {"word_id": word_id, "lemma": short(word.get("lemma")),
                                  "ok": True, "path": rel, "generated": generated})
        self._send_json(200, {"path": rel, "generated": generated})

    def _handle_example_audio(self):
        """Генерация/получение mp3 для примера: audio/<id>_<idx>.mp3"""
        body = self._read_json()
        if not isinstance(body, dict):
            self._send_json(400, {"error": "Нужны id и index"})
            return
        try:
            word_id = int(body.get("id"))
            idx = int(body.get("index"))
        except (TypeError, ValueError):
            self._send_json(400, {"error": "Нужны целые id и index"})
            return
        words = read_words()
        if not words:
            self._send_json(500, {"error": "data.json повреждён"})
            return
        word = next((w for w in words if int(w.get("id") or 0) == word_id), None)
        if word is None:
            self._send_json(404, {"error": "Слово не найдено"})
            return
        examples = word.get("examples") or []
        if idx < 0 or idx >= len(examples):
            self._send_json(404, {"error": "Пример не найден"})
            return
        text = (examples[idx].get("example") or "").strip()
        if not text:
            self._send_json(400, {"error": "Пустой текст примера"})
            return
        try:
            os.makedirs(AUDIO_DIR, exist_ok=True)
        except OSError:
            pass
        rel = "audio/%s_%s.mp3" % (word_id, idx)
        full = os.path.join(BASE_DIR, rel)
        generated = False
        if not os.path.isfile(full):
            try:
                audio = fish_tts_bytes(tts_speech_text(text))
                with open(full, "wb") as f:
                    f.write(audio)
                generated = True
            except Exception as e:
                log_event("example_audio", {"word_id": word_id, "index": idx, "text": short(text),
                                            "ok": False, "error": short(str(e), 300)})
                self._send_json(502, {"error": "TTS недоступен: " + str(e)})
                return
        if isinstance(examples[idx], dict):
            examples[idx]["audio"] = rel
            write_words(words)
        log_event("example_audio", {"word_id": word_id, "index": idx, "text": short(text),
                                    "ok": True, "path": rel, "generated": generated})
        self._send_json(200, {"path": rel, "generated": generated})

    def do_DELETE(self):
        path = urlparse(self.path).path
        m = re.match(r"^/api/words/(\d+)$", path)
        if not m:
            self._send_text(404, "Not found", "text/plain; charset=utf-8")
            return
        word_id = int(m.group(1))
        words = read_words()
        if words is None:
            self._send_json(500, {"error": "data.json повреждён (не JSON)"})
            return
        idx = next((i for i, w in enumerate(words) if int(w.get("id") or 0) == word_id), None)
        if idx is None:
            self._send_json(404, {"error": "Слово не найдено"})
            return
        removed = words.pop(idx)
        write_words(words)
        log_event("word_delete", {"id": word_id, "lemma": short(removed.get("lemma"))})
        try:
            os.makedirs(AUDIO_DIR, exist_ok=True)
            for name in os.listdir(AUDIO_DIR):
                if re.match(r"^%s(_\d+)?\.mp3$" % word_id, name):
                    try:
                        os.remove(os.path.join(AUDIO_DIR, name))
                    except OSError:
                        pass
        except OSError:
            pass
        self._send_json(200, {"ok": True, "removed": removed.get("lemma")})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()


def main():
    port = int(os.environ.get("PORT") or "8000")
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            port = 8000
    host = os.environ.get("HOST") or "127.0.0.1"
    server = ThreadingHTTPServer((host, port), Handler)
    print("Сервер запущен: http://%s:%d" % (host, port))
    print("Файл данных: %s" % DATA_FILE)
    print("Каталог аудио: %s" % AUDIO_DIR)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
