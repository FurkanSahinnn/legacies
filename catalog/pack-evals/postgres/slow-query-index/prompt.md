---
description: A slow filtered and sorted query needs a matching composite index, created without locking writes.
max_turns: 4
allowed_tools: [Read, Skill]
plugins: ["../..", "../../../.."]
---

PostgreSQL'de bu sorgu milyonlarca satırlık orders tablosunda yavaş: SELECT id, total FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20. Tablo üretimde sürekli yazılıyor. Hangi indeksi eklemeliyim? Migration SQL'ini de yaz.
