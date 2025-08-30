from flask import Flask, render_template_string
import csv
import requests
import io

app = Flask(__name__)

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbgLgN6Jd460AsuM2NSKwG347DtTQzPiyn-8gGxqWHG0Es69m-mnOFKQmuGZAdw/pubhtml"

@app.route("/")
def view_data():
    # Descargar CSV desde Google Sheets
    response = requests.get(CSV_URL)
    response.raise_for_status()

    # Leer CSV directamente desde memoria
    f = io.StringIO(response.text)
    reader = csv.reader(f)
    data = list(reader)

    # Renderizar en HTML
    html = "<h1>Datos desde Google Sheets</h1><table border=1>"
    for row in data:
        html += "<tr>" + "".join(f"<td>{col}</td>" for col in row) + "</tr>"
    html += "</table>"

    return render_template_string(html)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

