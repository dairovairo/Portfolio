import pandas as pd
from flask import Flask, render_template_string, request
from datetime import datetime
import time

app = Flask(__name__)

# URL del CSV
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQd_3Gh3drsN6jBf9VxUq2oZsuEYvJmC71Jv3rJdT5veSwM1hOLCwP4O3Lz9cRZ5k/pub?gid=1380536144&single=true&output=csv"

# Plantilla HTML
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Clasificación</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #111; color: #eee; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #444; padding: 8px; text-align: center; }
        th { background: #222; }
        tr:nth-child(even) { background: #1a1a1a; }
        select, button { padding: 5px 10px; margin: 10px 0; }
        .info { margin-top: 15px; font-size: 0.9em; color: #bbb; }
    </style>
</head>
<body>
    <h1>Clasificación</h1>

    <form method="get">
        <label for="categoria">Filtrar por categoría:</label>
        <select name="categoria" id="categoria" onchange="this.form.submit()">
            <option value="">Todas</option>
            {% for cat in categorias %}
                <option value="{{cat}}" {% if cat == categoria_seleccionada %}selected{% endif %}>{{cat}}</option>
            {% endfor %}
        </select>
    </form>

    <table>
        <thead>
            <tr>
                {% for col in columnas %}
                    <th>{{col}}</th>
                {% endfor %}
            </tr>
        </thead>
        <tbody>
            {% for fila in filas %}
                <tr>
                    {% for col, valor in zip(columnas, fila) %}
                        {% if col == 'Categoria' %}
                            <td>{{valor}}</td>
                        {% else %}
                            <td>{{valor}}</td>
                        {% endif %}
                    {% endfor %}
                </tr>
            {% endfor %}
        </tbody>
    </table>

    <div class="info">
        Última actualización: {{last_updated}} <br>
        Tiempo de procesamiento: {{elapsed_time}}
    </div>
</body>
</html>
"""

def format_elapsed(seconds: float) -> str:
    """Formatea segundos en milisegundos o segundos."""
    if seconds < 1:
        return f"{seconds*1000:.0f} ms"
    return f"{seconds:.2f} s"

@app.route("/", methods=["GET"])
def view_data():
    start_time = time.time()
    now = datetime.now()
    last_updated = now.strftime("%d/%m/%Y %H:%M:%S")

    # Leer CSV
    df = pd.read_csv(CSV_URL, skiprows=5)
    df = df.dropna(how="all")

    # Detectar número de columnas reales
    num_cols = df.shape[1]

    # Base fija sin tiradas
    columnas_base = ['Numero', 'Dorsal', 'Tirador', 'Categoria']
    columnas_tiradas = ['S1', 'S2', 'S3', 'S4', 'S5']
    columnas_extra = ['Total', 'Final', 'Total2']

    # Construir lista de nombres según el número de columnas
    tiradas_presentes = max(0, num_cols - len(columnas_base) - len(columnas_extra))
    all_columns = columnas_base + columnas_tiradas[:tiradas_presentes] + columnas_extra[:(num_cols - len(columnas_base) - tiradas_presentes)]

    df.columns = all_columns
    df = df.fillna("")

    # Detectar tiradas válidas (que existan y tengan algún dato)
    tiradas_validas = []
    for s in [c for c in columnas_tiradas if c in df.columns]:
        if df[s].replace("", float("nan")).notna().any():
            df[s] = pd.to_numeric(df[s], errors='coerce').fillna(0).astype(int)
            tiradas_validas.append(s)
        else:
            df = df.drop(columns=[s])

    # Convertir Total en int si existe
    if 'Total' in df.columns:
        df['Total'] = pd.to_numeric(df['Total'], errors='coerce').fillna(0).astype(int)

    # Ordenar por Total y tiradas válidas
    tiradas_validas_sorted = sorted(tiradas_validas, reverse=True)  # ej: S5, S4, S3...
    sort_cols = ['Total'] + tiradas_validas_sorted if 'Total' in df.columns else tiradas_validas_sorted

    df_sorted = (
        df.drop(columns=['Numero'], errors="ignore")
          .sort_values(by=sort_cols, ascending=False)
          .reset_index(drop=True)
    )

    # Reinsertar numeración
    df_sorted.insert(0, 'Numero', range(1, len(df_sorted)+1))

    # Filtros
    categorias = sorted(df_sorted['Categoria'].dropna().unique())
    categoria_seleccionada = request.args.get("categoria", "")
    if categoria_seleccionada:
        df_sorted = df_sorted[df_sorted['Categoria'] == categoria_seleccionada]

    columnas = df_sorted.columns.tolist()
    filas = df_sorted.to_numpy().tolist()
    categoria_idx = columnas.index('Categoria')

    elapsed_time = format_elapsed(time.time() - start_time)

    return render_template_string(
        HTML_TEMPLATE,
        columnas=columnas,
        filas=filas,
        categorias=categorias,
        categoria_seleccionada=categoria_seleccionada,
        categoria_idx=categoria_idx,
        last_updated=last_updated,
        elapsed_time=elapsed_time
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000, debug=True)
