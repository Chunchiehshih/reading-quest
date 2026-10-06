"""Bundle the site.

  python3 build.py

Writes:
  data.js                 window.RLQ_DATA = {texts, quests} from data/
  index.html              full page that loads src/ files (open locally or host as static site)
  dist/reading-quest.html single-file version with everything inlined
  backend/Index.html      same single file, for pasting into the Apps Script project
"""
import glob, json, os

ROOT = os.path.dirname(os.path.abspath(__file__))
p = lambda *a: os.path.join(ROOT, *a)

texts = json.load(open(p("data", "texts.json"), encoding="utf-8"))["texts"]
quests = [json.load(open(f, encoding="utf-8")) for f in sorted(glob.glob(p("data", "quests", "*.json")))]
data_js = "window.RLQ_DATA = " + json.dumps({"texts": texts, "quests": quests}, ensure_ascii=False).replace("</", "<\\/") + ";\n"
open(p("data.js"), "w", encoding="utf-8").write(data_js)

page = open(p("src", "page.html"), encoding="utf-8").read()
css = open(p("src", "styles.css"), encoding="utf-8").read()
app = open(p("src", "app.js"), encoding="utf-8").read()
qr = open(p("vendor", "qrcode.js"), encoding="utf-8").read()
config = open(p("config.js"), encoding="utf-8").read()

cut = page.index("<header")
head, body = page[:cut], page[cut:]
index = (
    '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + head.replace("<!--STYLES-->", '<link rel="stylesheet" href="src/styles.css">')
    + "</head>\n<body>\n"
    + body.replace("<!--SCRIPTS-->", '<script src="config.js"></script>\n<script src="vendor/qrcode.js"></script>\n<script src="data.js"></script>\n<script src="src/app.js"></script>')
    + "</body>\n</html>\n"
)
open(p("index.html"), "w", encoding="utf-8").write(index)

os.makedirs(p("dist"), exist_ok=True)
single = page.replace("<!--STYLES-->", "<style>\n" + css + "</style>").replace(
    "<!--SCRIPTS-->", "<script>\n" + config + "</script>\n<script>\n" + qr + "</script>\n<script>\n" + data_js + "</script>\n<script>\n" + app + "</script>")
open(p("dist", "reading-quest.html"), "w", encoding="utf-8").write(single)
open(p("backend", "Index.html"), "w", encoding="utf-8").write(single)
print("texts", len(texts), "quests", len(quests), "single-file", len(single.encode()) // 1024, "KB")
