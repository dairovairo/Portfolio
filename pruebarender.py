import pandas as pd
import sqlite3
from flask import Flask, render_template_string, request
import os

# ---------------- Configuración ----------------
EXCEL_PATH = "RESULTADOS FINALES PLANTILLA.xlsm"  # Debe estar en la raíz del repo
DB_PATH = "torneo.db"

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="10">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Campeonato de Tiro al Plato - Resultados</title>
<style>
body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin:0; background:#f4f6f8; color:#333; }
header { background: linear-gradient(to right, #004080, #007BFF); color:white; padding:20px 40px; text-align:center; }
header h1 { margin:0; font-size:2.5em; }
main { padding:30px; max-width:95%; margin:auto; }
table { width:100%; border-collapse:collapse; background:#e5e5e5; }
th, td { padding:10px 14px; border:1px solid #ddd; text-align:center; }
th { background-color:#ccc; color:black; position:sticky; top:0; }
tr:nth-child(even) { background-color:#f9f9f9; }
tr:hover { background-color:#eef; }
form { margin-bottom:20px; text-align:center; }
select, button { padding:5px 10px; font-size:1em; }
button { background:#007BFF; color:white; border:none; border-radius:4px; cursor:pointer; }
button:hover { background:#0056b3; }
</style>
</head>
<body>
<header>
<h1>🏆 Campeonato de Tiro al Plato</h1>
<p>Resultados actualizados en tiempo real</p>
</header>
<main>
<form method="get">
<label for="categoria">Filtrar por categoría:</label>
<select name="categoria" id="categoria">
<option value="">-- Todas --</option>
{% for cat in categorias %}
<option value="{{ cat }}" {% if cat == categoria_seleccionada %}selected{% endif %}>{{ cat }}</option>
{% endfor %}
</select>
<button type="submit">Filtrar</button>
</form>
<table>
<thead>
<tr>
{% for col in columnas %}
<th>{{ col }}</th>
{% endfor %}
</tr>
</thead>
<tbody>
{% for fila in filas %}
<tr>
{% for celda in fila %}
<td data-label="{{ columnas[loop.index0] }}">{{ celda }}</td>
{% endfor %}
</tr>
{% endfor %}
</tbody>
</table>
</main>
</body>
</html>
"""

# ---------------- Flask App ----------------
app = Flask(__name__)

# ---------------- Funciones ----------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS listado (
            Numero INTEGER PRIMARY KEY,
            Dorsal TEXT,
            Tirador TEXT,
            Categoria TEXT,
            S1 REAL,
            S2 REAL,
            S3 REAL,
            S4 REAL,
            Total REAL,
            Final REAL,
            Total2 REAL
        )
    """)
    conn.commit()
    conn.close()

def importar_excel():
    if not os.path.exists(EXCEL_PATH):
        print(f"⚠️ Excel no encontrado: {EXCEL_PATH}")
        return

    df = pd.read_excel(EXCEL_PATH, sheet_name="RESULTADOS FINALES", skiprows=4)
    df = df[1:]  # Ignorar fila innecesaria
    df.columns = ['Numero', 'Dorsal', 'Tirador', 'Categoria', 'S1', 'S2', 'S3', 'S4', 'Total', 'Final', 'Total2']

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    for _, row in df.iterrows():
        cleaned_row = [None if pd.isna(x) else x for x in row]
        if not isinstance(cleaned_row[0], (int, float)):
            continue
        cursor.execute("""
            INSERT OR REPLACE INTO listado
            (Numero, Dorsal, Tirador, Categoria, S1, S2, S3, S4, Total, Final, Total2)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, tuple(cleaned_row))
    conn.commit()
    conn.close()
    print("✅ Datos importados desde el Excel a SQLite")

# ---------------- Inicialización antes del primer request ----------------
@app.before_first_request
def inicializar():
    init_db()
    importar_excel()

# ---------------- Ruta principal ----------------
@app.route("/")
def ver_resultados():
    categoria = request.args.get("categoria", default="")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("SELECT DISTINCT Categoria FROM listado ORDER BY Categoria")
    categorias = [row[0] for row in cursor.fetchall() if row[0]]

    if categoria:
        cursor.execute("SELECT * FROM listado WHERE Categoria=? ORDER BY Numero ASC", (categoria,))
    else:
        cursor.execute("SELECT * FROM listado ORDER BY Numero ASC")

    filas = cursor.fetchall()
    columnas = [desc[0] for desc in cursor.description]

    conn.close()

    return render_template_string(
        HTML_TEMPLATE,
        columnas=columnas,
        filas=filas,
        categorias=categorias,
        categoria_seleccionada=categoria
    )

# ---------------- Arranque ----------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
