from flask import Flask, render_template_string, request
import pandas as pd
from datetime import datetime

app = Flask(__name__)

CSV_URL = "https://docs.google.com/spreadsheets/d/1AAcHY3YEgKy7F2OKNWSieYja4LPnlj0A/edit?usp=sharing&ouid=106278751517880292598&rtpof=true&sd=true"

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<style>
body {
    font-family: Arial, sans-serif;
    background-color: #ffffff; /* fondo blanco liso */
    color: #000; /* texto negro */
    text-align: center;
    padding: 20px;
}

h1 {
    color: #ff7f00; 
    margin-bottom: 5px;
}

.last-updated {
    font-size: 16px;
    color: #ff7f00;
    margin-bottom: 20px;
}

select {
    padding: 5px 10px;
    margin-bottom: 20px;
    border-radius: 5px;
    border: 1px solid #ff7f00;
}

.table-container {
    width: 90%;
    margin: 0 auto;
    background-color: #ffffff;
    box-shadow: 0 0 10px #ff7f00;
    max-height: 80vh;
    overflow-y: auto; 
    border-radius: 5px;
}

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
    background-color: #ff7f00;
    color: #fff;
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

<h1>RESULTADOS EN DIRECTO LA ISLA</h1>
<p class="last-updated">
    Última actualización en la web: {{ last_updated }}<br>
    (hace {{ elapsed_time }})
</p>

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

def format_elapsed(delta_seconds):
    delta_seconds = int(delta_seconds)
    if delta_seconds < 60:
        return f"{delta_seconds} segundos"
    elif delta_seconds < 3600:
        return f"{delta_seconds//60} minutos"
    elif delta_seconds < 86400:
        return f"{delta_seconds//3600} horas"
    else:
        return f"{delta_seconds//86400} días"

@app.route("/", methods=["GET"])
def view_data():
    now = datetime.now()
    last_updated = now.strftime("%d/%m/%Y %H:%M:%S")

    df = pd.read_csv(CSV_URL, skiprows=5)
    df = df.dropna(how="all")

    # Columnas esperadas con hasta 5 tiradas
    expected_cols = ['Numero', 'Dorsal', 'Tirador', 'Categoria',
                     'S1', 'S2', 'S3', 'S4', 'S5',
                     'Total', 'Final', 'Total2']
    df.columns = expected_cols[:len(df.columns)]
    df = df.fillna("")

    # Conversión a int de Total y tiradas
    if "Total" in df.columns:
        df['Total'] = pd.to_numeric(df['Total'], errors='coerce').fillna(0).astype(int)
    for s in ['S1', 'S2', 'S3', 'S4', 'S5']:
        if s in df.columns:
            df[s] = pd.to_numeric(df[s], errors='coerce').fillna(0).astype(int)

    # Tiradas realmente presentes con datos
    tiradas = [s for s in ['S5', 'S4', 'S3', 'S2', 'S1']
               if s in df.columns and df[s].sum() > 0]

    df_sorted = (
        df.drop(columns=['Numero'])
          .sort_values(by=(['Total'] + tiradas if "Total" in df.columns else tiradas),
                       ascending=False)
          .reset_index(drop=True)
    )

    df_sorted.insert(0, 'Numero', range(1, len(df_sorted)+1))

    categorias = sorted(df_sorted['Categoria'].dropna().unique())
    categoria_seleccionada = request.args.get("categoria", "")
    if categoria_seleccionada:
        df_sorted = df_sorted[df_sorted['Categoria'] == categoria_seleccionada]

    # Columnas visibles → ocultamos tiradas sin datos
    columnas_visibles = [c for c in df_sorted.columns
                         if not (c in ['S1','S2','S3','S4','S5'] and df_sorted[c].sum() == 0)]

    filas = df_sorted[columnas_visibles].to_numpy().tolist()
    categoria_idx = columnas_visibles.index('Categoria')

    elapsed_time = format_elapsed((datetime.now() - now).total_seconds())

    return render_template_string(
        HTML_TEMPLATE,
        columnas=columnas_visibles,
        filas=filas,
        categorias=categorias,
        categoria_seleccionada=categoria_seleccionada,
        categoria_idx=categoria_idx,
        last_updated=last_updated,
        elapsed_time=elapsed_time
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
