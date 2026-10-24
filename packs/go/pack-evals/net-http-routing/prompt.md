---
description: Go 1.22+ standard-library routing and server timeouts.
max_turns: 4
allowed_tools: [Read, Skill]
plugins: ["../..", "../../../.."]
---

Go 1.22 ve sonrası için yalnızca standart kütüphaneyle bir HTTP servisi yaz: GET /users/{id} isteğinde id'yi yoldan alıp JSON dönen bir handler ve üretime uygun ayarlanmış bir http.Server. Sadece main.go'yu ver.
