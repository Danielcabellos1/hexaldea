# Comprueba con OpenCV que los QR generados se leen bien.
import json, subprocess, sys, numpy as np, cv2
texts = ["https://danielcabellos1.github.io/hexaldea/?sala=K7MQ2X", "A", "hola ñandú €", "https://ejemplo.github.io/x/?sala=ABCDEF&llave=abcdefghij0123456789",
         "x"*100, "https://"+"a"*150+".com/?sala=QQQQQQ"]
js = "const QR=require('./src/qr.js');const t=%s;console.log(JSON.stringify(t.map(s=>{const q=QR.encode(s);return {v:q.ver,m:q.mod.map(r=>r.map(b=>b?1:0).join('')).join('|')}})))" % json.dumps(texts)
out = json.loads(subprocess.check_output(["node","-e",js]))
det = cv2.QRCodeDetector(); ok = 0
for t, q in zip(texts, out):
    rows = [[int(c) for c in r] for r in q["m"].split("|")]
    n = len(rows); sc = 8; img = np.full(((n+8)*sc,(n+8)*sc), 255, np.uint8)
    for y in range(n):
        for x in range(n):
            if rows[y][x]: img[(y+4)*sc:(y+5)*sc,(x+4)*sc:(x+5)*sc] = 0
    val, pts, _ = det.detectAndDecode(img)
    good = val == t
    ok += good
    print(("ok  " if good else "FALLO"), "v%d" % q["v"], repr(t[:50]), "" if good else repr(val))
print(ok, "/", len(texts)); sys.exit(0 if ok == len(texts) else 1)
