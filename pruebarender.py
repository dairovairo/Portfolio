from flask import Flask, render_template_string, request
import pandas as pd

app = Flask(__name__)

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbgLgN6Jd460AsuM2NSKwG347DtTQzPiyn-8gGxqWHG0Es69m-mnOFKQmuGZAdw/pub?output=csv&gid=110548680"

HTML_TEMPLATE = """
<h1>Datos desde Google Sheets</h1>

<label for="categoriaFilter">Filtrar por CATEGORIA:</label>
<select id="categoriaFilter" onchange="filterTable()">
    <option value="">Todas</option>
    {% for cat in categorias %}
        <option value="{{cat}}" {% if cat == categoria_seleccionada %}selected{% endif %}>{{cat}}</option>
    {% endfor %}
</select>

<table border="1" id="dataTable">
    <thead>
        <tr>
            {% for col in columnas %}
                <th>{{col}}</th>
            {% endfor %}
        </tr>
    </thead>
    <tbody>
        {% for row in filas %}
            <tr>
                {% for cell in row %}
                    <td>{{cell}}</td>
                {% endfor %}
            </tr>
        {% endfor %}
    </tbody>
</table>

<script>
function filterTable() {
    var filter = document.getElementById("categoriaFilter").value.toUpperCase();
    var table = document.getElementById("dataTable");
    var tr = table.getElementsByTagName("tr");
    var categoria_idx = {{categoria_idx}};
    for (var i = 1; i < tr.length; i++) {
        var td = tr[i].getElementsByTagName("td")[categoria_idx];
        if (td) {
            var txtValue = td.textContent || td.innerText;
            tr[i].style.display = txtValue.toUpperCase().indexOf(filter) > -1 ? "" : "none";
        }
    }
}
</script>
"""

@app.route("/", methods=["GET"])
def view_data():
    # Leer CSV desde Google Sheets usando pandas
    df = pd.read_csv(CSV_URL)

    # Eliminar filas completamente vacías
    df = df.dropna(how="all")

    # Reasignar nombres de columnas según tus necesidades
    df.columns = ['Numero', 'Dorsal', 'Tirador', 'Categoria', 'S1', 'S2', 'S3', 'S4', 'Total', 'Final', 'Total2']

    # Ordenar por Total de mayor a menor
    df['Total'] = pd.to_numeric(df['Total'], errors='coerce').fillna(0)
    df = df.sort_values(by='Total', ascending=False)

    # Obtener todas las categorías únicas
    categorias = sorted(df['Categoria'].dropna().unique())

    # Obtener categoría seleccionada del filtro
    categoria_seleccionada = request.args.get("categoria", "")

    # Filtrar filas si se seleccionó alguna categoría
    if categoria_seleccionada:
        df = df[df['Categoria'] == categoria_seleccionada]

    columnas = df.columns.tolist()
    filas = df.values.tolist()
    categoria_idx = columnas.index('Categoria')

    return render_template_string(
        HTML_TEMPLATE,
        columnas=columnas,
        filas=filas,
        categorias=categorias,
        categoria_seleccionada=categoria_seleccionada,
        categoria_idx=categoria_idx
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
