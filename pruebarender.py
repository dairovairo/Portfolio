from flask import Flask, render_template_string, request
import pandas as pd

app = Flask(__name__)

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbgLgN6Jd460AsuM2NSKwG347DtTQzPiyn-8gGxqWHG0Es69m-mnOFKQmuGZAdw/pub?output=csv&gid=110548680"

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<style>
body {
    font-family: Arial, sans-serif;
    background-color: #2b2b2b;  /* Gris oscuro */
    color: #fff;
    text-align: center;
    padding: 20px;
}

h1 {
    color: #0ff;
    text-shadow: 0 0 10px #0ff;
    margin-bottom: 20px;
}

select {
    padding: 5px 10px;
    margin-bottom: 20px;
    border-radius: 5px;
    border: none;
}

table {
    margin: 0 auto;
    border-collapse: collapse;
    width: 90%;
    background-color: #111;
    box-shadow: 0 0 20px #0ff;
}

th, td {
    padding: 8px 12px;
    border: 1px solid #0ff;
    text-align: center;
}

th {
    background-color: #222;
    color: #0ff;
}

tr:hover {
    background-color: #0ff;
    color: #000;
}

option[selected] {
    background-color: #0ff;
    color: #000;
}
</style>
</head>
<body>

<h1>Campeonato de tiro</h1>

<label for="categoriaFilter">Filtrar por CATEGORIA:</label>
<select id="categoriaFilter" onchange="filterTable()">
    <option value="">Todas</option>
    {% for cat in categorias %}
        <option value="{{cat}}" {% if cat == categoria_seleccionada %}selected{% endif %}>{{cat}}</option>
    {% endfor %}
</select>

<table id="dataTable">
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

</body>
</html>
"""

@app.route("/", methods=["GET"])
def view_data():
    # Saltar las dos primeras filas del CSV
    df = pd.read_csv(CSV_URL, skiprows=4)
    df = df.dropna(how="all")
    
    # Asignar nombres de columnas correctos
    df.columns = ['Numero', 'Dorsal', 'Tirador', 'Categoria', 'S1', 'S2', 'S3', 'S4', 'Total', 'Final', 'Total2']
    df = df.fillna("")  # Reemplazar NaN por cadena vacía

    # Ordenar por Total de mayor a menor
    df['Total'] = pd.to_numeric(df['Total'], errors='coerce').fillna(0)
    df = df.sort_values(by='Total', ascending=False)

    # Categorías únicas
    categorias = sorted(df['Categoria'].dropna().unique())
    categoria_seleccionada = request.args.get("categoria", "")
    if categoria_seleccionada:
        df = df[df['Categoria'] == categoria_seleccionada]

    columnas = df.columns.tolist()
    filas = df.to_numpy().tolist()  # Solo los datos, sin duplicar encabezados
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


