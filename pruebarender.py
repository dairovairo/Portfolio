from flask import Flask, render_template_string, request
import csv

app = Flask(__name__)

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head><title>Resultados</title></head>
<body>
<h1>Resultados desde Google Sheets</h1>
<table border="1">
<tr>{% for header in headers %}<th>{{ header }}</th>{% endfor %}</tr>
{% for row in rows %}
<tr>{% for cell in row %}<td>{{ cell }}</td>{% endfor %}</tr>
{% endfor %}
</table>
</body>
</html>
"""

@app.route("/")
def view_data():
    with open("datos.csv", newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        data = list(reader)
    headers = data[0] if data else []
    rows = data[1:] if len(data) > 1 else []
    return render_template_string(HTML_TEMPLATE, headers=headers, rows=rows)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
