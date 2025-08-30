from flask import Flask, render_template_string, request
import csv
import requests
import io

app = Flask(__name__)

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbgLgN6Jd460AsuM2NSKwG347DtTQzPiyn-8gGxqWHG0Es69m-mnOFKQmuGZAdw/pub?output=csv&gid=110548680"


@app.route("/", methods=["GET"])
def view_data():
    # Descargar CSV desde Google Sheets
    response = requests.get(CSV_URL)
    response.raise_for_status()

    # Leer CSV directamente desde memoria
    f = io.StringIO(response.text)
    reader = csv.reader(f)
    data = list(reader)

    # Obtener encabezados
    headers = data[0]
    rows = data[1:]

    # Ordenar por columna TOTAL (asumiendo que la columna se llama exactamente "TOTAL")
    total_idx = headers.index("TOTAL")
    rows.sort(key=lambda x: float(x[total_idx].replace(',', '').strip() or 0), reverse=True)

    # Obtener todas las categorías únicas para el filtro
    categoria_idx = headers.index("CAT")
    categorias = sorted(set(row[categoria_idx] for row in rows))

    # Renderizar HTML
    html = """
    <h1>Datos desde Google Sheets</h1>

    <label for="categoriaFilter">Filtrar por CATEGORIA:</label>
    <select id="categoriaFilter" onchange="filterTable()">
        <option value="">Todas</option>
    """
    for cat in categorias:
        html += f'<option value="{cat}">{cat}</option>'
    html += "</select>"

    html += '<table border="1" id="dataTable"><thead><tr>'
    for header in headers:
        html += f"<th>{header}</th>"
    html += "</tr></thead><tbody>"

    for row in rows:
        html += "<tr>" + "".join(f"<td>{col}</td>" for col in row) + "</tr>"

    html += "</tbody></table>"

    # JavaScript para filtrar por categoría
    html += """
    <script>
    function filterTable() {
        var filter = document.getElementById("categoriaFilter").value.toUpperCase();
        var table = document.getElementById("dataTable");
        var tr = table.getElementsByTagName("tr");
        for (var i = 1; i < tr.length; i++) {
            var td = tr[i].getElementsByTagName("td")[%d];
            if (td) {
                var txtValue = td.textContent || td.innerText;
                tr[i].style.display = txtValue.toUpperCase().indexOf(filter) > -1 ? "" : "none";
            }
        }
    }
    </script>
    """ % categoria_idx

    return render_template_string(html)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)


