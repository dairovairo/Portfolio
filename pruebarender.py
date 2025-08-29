import pandas as pd
import sqlite3
from flask import Flask, render_template_string, request
import os

app = Flask(__name__)

DB_PATH = "torneo.db"
EXCEL_PATH = "RESULTADOS FINALES PLANTILLA.xlsm"

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Resultados Torneo</title>
</head>
<body>
<h1>Resultados del Torneo</h1>
<form method="get">
Filtrar por categoría: 
<select name="categoria">
<option value="">-- Todas --</option>
{% for cat in categorias %}
<option value="{{ cat }}" {% if cat==categoria %}selected{% endif %}>{{ cat }}</option>
{% endfor %}
</select>
<button>Filtrar</button>
</form>
<table border=1>
<tr>{% for col in columnas %}<th>{{ col }}</th>{% endfor %}</tr>
{% for fila in filas %}
<tr>{% for celda in fila %}<td>{{ celda }}</td>{% endfor %}</tr>
{% endfor %}
</table>
</body>
</html>
"""

# Función para crear la DB y tabla si no existe
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS listado (
        Numero INTEGER PRIMARY KEY,
        Dorsal TEXT,
        Tirador TEXT,
        Categoria TEXT,
        S1 INTEGER,
        S2 INTEGER,
        S3 INTEGER,
        S4 INTEGER,
        Total INTEGER,
        Final INTEGER,
        Total2 INTEGER
    )
    """)
    conn.commit()
    conn.close()

# Función para importar Excel a SQLite
def importar_excel():
    df = pd.read_excel(EXCEL_PATH, sheet_name="RESULTADOS FINALES", skiprows=4)
    df = df[1:]
    df.columns = ['Numero','Dorsal','Tirador','Categoria','S1','S2','S3','S4','Total','Final','Total2']

    conn = sqlite3.connect(DB_PATH)
    df.to_sql("listado", conn, if_exists="replace", index=False)
    conn.close()

# Ruta principal
@app.route("/")
def ver_resultados():
    categoria = request.args.get("categoria","")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT DISTINCT Categoria FROM listado ORDER BY Categoria")
    categorias = [row[0] for row in cursor.fetchall()]

    if categoria:
        cursor.execute("SELECT * FROM listado WHERE Categoria=? ORDER BY Numero ASC", (categoria,))
    else:
        cursor.execute("SELECT * FROM listado ORDER BY Numero ASC")
    
    filas = cursor.fetchall()
    columnas = [description[0] for description in cursor.description]
    conn.close()
    
    return render_template_string(HTML_TEMPLATE, columnas=columnas, filas=filas, categorias=categorias, categoria=categoria)

if __name__ == "__main__":
    init_db()
    importar_excel()
    app.run(host="0.0.0.0", port=5000)
