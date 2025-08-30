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

    # Ignorar columnas vacías al buscar encabezados
    headers = [h for h in data[0] if h.strip() != ""]
    rows = data[1:]

    # Encontrar índices de las columnas que necesitamos
    try:
        total_idx = next(i for i, h in enumerate(data[0]) if h.strip().upper() == "TOTAL")
        categoria_idx = next(i for i, h in enumerate(data[0]) if h.strip().upper() == "CAT")
    except StopIteration:
        return "No se encontraron las columnas TOTAL o CAT en el CSV"

    # Ordenar por TOTAL de mayor a menor
    rows.sort(key=lambda x: float(x[total_idx].replace(',', '').strip() or 0), reverse=True)

    # Todas las categorías únicas para el filtro
    categorias = sorted(set(row[categoria_idx] for row in rows if row[categoria_idx].strip() != ""))

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
    for h in headers:
        html += f"<th>{h}</th>"
    html += "</tr></thead><tbody>"

    for row in rows:
        html += "<tr>" + "".join(f"<td>{col}</td>" for col in row[:len(headers)]) + "</tr>"

    html += "</tbody></table>"

    html += f"""
    <script>
    function filterTable() {{
        var filter = document.getElementById("categoriaFilter").value.toUpperCase();
        var table = document.getElementById("dataTable");
        var tr = table.getElementsByTagName("tr");
        for (var i = 1; i < tr.length; i++) {{
            var td = tr[i].getElementsByTagName("td")[{categoria_idx}];
            if (td) {{
                var txtValue = td.textContent || td.innerText;
                tr[i].style.display = txtValue.toUpperCase().indexOf(filter) > -1 ? "" : "none";
            }}
        }}
    }}
    </script>
    """

    return render_template_string(html)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
