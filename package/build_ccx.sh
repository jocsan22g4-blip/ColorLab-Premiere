#!/bin/bash
#
# Construye el .ccx del panel para distribuirlo (sin Marketplace).
#
#   package/build_ccx.sh [version]      -> dist/ColorLab-Panel-<version>.ccx
#
# Un .ccx es un ZIP con el manifest en la raiz. Un .ccx de UXP no necesita
# firma. Lo unico que cambia respecto al panel de desarrollo es la IDENTIDAD:
# el id del manifest pasa de "...prototype" al definitivo, y la version, a la
# de producto. Asi el panel de desarrollo (cargado con UXP Developer Tool) y el
# instalado conviven sin pisarse.
#
# El id definitivo no se cambia nunca: Premiere/Creative Cloud identifican por
# el el plugin instalado.

set -euo pipefail

VERSION="${1:-1.0.0}"
ID="com.jocsankleyver.colorlab.premiere"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp -R "$HERE/panel/." "$WORK/"

python3 - "$WORK/manifest.json" "$ID" "$VERSION" <<'PY'
import json, sys
p, ident, ver = sys.argv[1:4]
m = json.load(open(p))
m["id"] = ident
m["version"] = ver
assert isinstance(m["host"], dict), "host debe ser un unico objeto para distribuir"
json.dump(m, open(p, "w"), indent=2, ensure_ascii=False)
PY

mkdir -p "$HERE/dist"
OUT="$HERE/dist/ColorLab-Panel-$VERSION.ccx"
rm -f "$OUT"
(cd "$WORK" && zip -q -r -X "$OUT" . -x '*.DS_Store')
echo "build_ccx.sh: $OUT  ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -n +4 | head -20
