from flask import Flask, render_template_string, request
import pandas as pd
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from datetime import datetime
from googleapiclient.discovery import build

app = Flask(__name__)

# 🔑 Configuración credenciales de Google
scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive"
]
creds = ServiceAccountCredentials.from_json_keyfile_name("credenciales.json", scope)
client = gspread.authorize(creds)

# 📊 Abrir la hoja (cambia "Resultados" por el nombre de tu archivo en Google Drive)
spreadsheet = client.open("Resultados")
worksheet = spreadsheet.sheet1   # primera pestaña, la de resultados

# 📂 Servicio extra para metadatos (última modificación)
drive_service = build("drive", "v3", credentials=creds)
spreadsheet_id = spreadsheet.id

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<style>
/* mismos estilos que ya tenías */
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
h1 { color: #ff7f00; text-shadow: 0 0 10px #ff7f00; margin-bottom: 20px; }
.table-container { width: 90%; margin: 0 auto; background-color: rgba(17,17,17,0.9); box-shadow: 0 0 20px #ff7f00; max-height: 80vh; overflow-y: auto; border-radius: 5px; }
th, td { padding: 5px 8px; border: 1px solid #ff7f00; text-align: center; }
th { background-color: rgba(34,34,34,0.9); color: #ff7f00; }
tr:hover { background-color: #ff7f00; color: #000; }
</style>
</head>
<body>

<h1>Campeonato de tiro</h1>
<p><em>Última actualización: {{ ultima_modificacion }}</em></p>

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

<h2>Enviar un comentario</h2>
<form method="post" action="/comentario">
    <textarea name="comentario" rows="4" cols="40"></textarea><br>
    <button type="submit">Enviar</button>
</form>

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
    # 📥 Leer datos de la hoja
    data = worksheet.get_all_values()
    df = pd.DataFrame(data[6:], columns=['Numero', 'Dorsal', 'Tirador', 'Categoria', 'S1', 'S2', 'S3', 'S4', 'Total', 'Final', 'Total2'])
    df = df.dropna(how="all").fillna("")

    # 🔢 Conversión a números
    df['Total'] = pd.to_numeric(df['Total'], errors='coerce').fillna(0)
    for s in ['S1', 'S2', 'S3', 'S4']:
        df[s] = pd.to_numeric(df[s], errors='coerce').fillna(0)

    # 📊 Orden con desempates
    tiradas = ['S4', 'S3', 'S2', 'S1']
    df_sorted = (
        df.drop(columns=['Numero'])
          .sort_values(by=['Total'] + tiradas, ascending=False)
          .reset_index(drop=True)
    )
    df_sorted.insert(0, 'Numero', range(1, len(df_sorted)+1))

    # 🎯 Filtro categorías
    categorias = sorted(df_sorted['Categoria'].dropna().unique())
    categoria_seleccionada = request.args.get("categoria", "")
    if categoria_seleccionada:
        df_sorted = df_sorted[df_sorted['Categoria'] == categoria_seleccionada]

    columnas = df_sorted.columns.tolist()
    filas = df_sorted.to_numpy().tolist()
    categoria_idx = columnas.index('Categoria')

    # ⏱️ Fecha de última modificación
    meta = drive_service.files().get(fileId=spreadsheet_id, fields="modifiedTime").execute()
    ultima_modificacion = meta["modifiedTime"]

    return render_template_string(
        HTML_TEMPLATE,
        columnas=columnas,
        filas=filas,
        categorias=categorias,
        categoria_seleccionada=categoria_seleccionada,
        categoria_idx=categoria_idx,
        ultima_modificacion=ultima_modificacion
    )

@app.route("/comentario", methods=["POST"])
def guardar_comentario():
    comentario = request.form.get("comentario")
    if comentario:
        # Guardar comentario en fila 250+ (columna A)
        worksheet.update_cell(250, 1, f"{datetime.now().isoformat()} - {comentario}")
    return "✅ ¡Comentario guardado en la hoja!"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
