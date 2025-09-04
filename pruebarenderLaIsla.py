from flask import Flask, render_template_string, request
import pandas as pd

app = Flask(__name__)

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbgLgN6Jd460AsuM2NSKwG347DtTQzPiyn-8gGxqWHG0Es69m-mnOFKQmuGZAdw/pub?gid=110548680&single=true&output=csv"

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<style>
body {
    font-family: Arial, sans-serif;
    background-color: #2b2b2b;
    background-image: url('https://i.pinimg.com/1200x/c1/a8/9c/c1a89cc9d2824d7aacc448680adfd759.jpg');
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    background-attachment: fixed;
    color: #fff;
    text-align: center;
    padding: 20px;
}

h1 {
    color: #ff7f00; 
    text-shadow: 0 0 10px #ff7f00;
    margin-bottom: 20px;
}

select {
    padding: 5px 10px;
    margin-bottom: 20px;
    border-radius: 5px;
    border: none;
}

.table-container {
    width: 90%;
    margin: 0 auto;
    background-color: rgba(17,17,17,0.9);
    box-shadow: 0 0 20px #ff7f00;
    max-height: 80vh;   /* ahora ocupa el 80% de la pantalla */
    overflow-y: auto; 
    border-radius: 5px;
}

/* En móviles la tabla ocupa casi toda la pantalla */
@media (max-width: 768px) {
    .table-container {
        width: 100%;
        max-height: 90vh;
    }

    th, td {
        padding: 4px 6px;
        font-size: 14px;
    }
}

table {
    width: 100%;
    border-collapse: collapse;
}

th, td {
    padding: 5px 8px;
    border: 1px solid #ff7f00;
    text-align: center;
}

th {
    background-color: rgba(34,34,34,0.9);
    color: #ff7f00;
}

tr:hover {
    background-color: #ff7f00;
    color: #000;
}

option[selected] {
    background-color: #ff7f00;
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

<div class="table-container">
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
</div>

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
    # Leer datos desde Google Sheets
    df = pd.read_csv(CSV_URL, skiprows=5)
    df = df.dropna(how="all")
    df.columns = ['Numero', 'Dorsal', 'Tirador', 'Categoria', 'S1', 'S2', 'S3', 'S4', 'Total', 'Final', 'Total2']
    df = df.fillna("")

    # Convertir a numérico
    df['Total'] = pd.to_numeric(df['Total'], errors='coerce').fillna(0)
    for s in ['S1', 'S2', 'S3', 'S4']:
        df[s] = pd.to_numeric(df[s], errors='coerce').fillna(0)

    # Orden con desempates: primero Total, luego S4, S3, S2, S1
    tiradas = ['S4', 'S3', 'S2', 'S1']
    df_sorted = (
        df.drop(columns=['Numero'])
          .sort_values(by=['Total'] + tiradas, ascending=False)
          .reset_index(drop=True)
    )

    # Nueva numeración (clasificación)
    df_sorted.insert(0, 'Numero', range(1, len(df_sorted)+1))

    # Filtro de categorías
    categorias = sorted(df_sorted['Categoria'].dropna().unique())
    categoria_seleccionada = request.args.get("categoria", "")
    if categoria_seleccionada:
        df_sorted = df_sorted[df_sorted['Categoria'] == categoria_seleccionada]

    columnas = df_sorted.columns.tolist()
    filas = df_sorted.to_numpy().tolist()
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




