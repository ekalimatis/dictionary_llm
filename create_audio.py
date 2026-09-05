# -*- coding: utf-8 -*-
"""Генерация mp3 для всех слов из data.json через fish.audio."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import server

words = server.read_words()
if not words:
    print("Список слов пуст или повреждён")
    sys.exit(1)

ok_count = 0
errors = []
for w in words:
    if w.get("audio") and os.path.exists(os.path.join(server.BASE_DIR, w["audio"])):
        ok_count += 1
        continue
    res = server.save_word_audio(w)
    if "path" in res:
        w["audio"] = res["path"]
        ok_count += 1
        print("OK  [%s] %s -> %s" % (w.get("id"), w.get("lemma"), res["path"]))
    else:
        errors.append((w.get("lemma"), res.get("error", "?")))
        print("ERR [%s] %s : %s" % (w.get("id"), w.get("lemma"), res.get("error")))

server.write_words(words)
print("---")
print("Готово: %d файлов, ошибок: %d" % (ok_count, len(errors)))
for lemma, err in errors:
    print("  - %s: %s" % (lemma, err))
