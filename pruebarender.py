import mysql.connector
from flask import Flask, render_template_string, request

# HTML básico
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Resultados Campeonato</title>
</head>
<body>
    <h1>🏆 Campeonato de Tiro al Plato</h1>
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

    <table border="1" cellpadding="5">
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
                <td>{{ celda }}</td>
                {% endfor %}
            </tr>
            {% endfor %}
        </tbody>
    </table>
</body>
</html>
"""

# Flask
app = Flask(__name__)

# 🔌 Conexión BD (ajusta con tus datos de hosting MySQL en la nube)
def conectar_db():
    return mysql.connector.connect(
        host="TU_HOST_MYSQL",
        user="TU_USUARIO",
        password="TU_PASSWORD",
        database="torneobueno"
    )

@app.route("/")
def ver_resultados():
    try:
        categoria = request.args.get("categoria", default="")

        conn = conectar_db()
        cursor = conn.cursor()

        # Categorías únicas
        cursor.execute("SELECT DISTINCT Categoria FROM listado ORDER BY Categoria")
        categorias = [row[0] for row in cursor.fetchall() if row[0]]

        # Consulta principal
        if categoria:
            cursor.execute("SELECT * FROM listado WHERE Categoria = %s ORDER BY Numero ASC", (categoria,))
        else:
            cursor.execute("SELECT * FROM listado ORDER BY Numero ASC")

        filas = cursor.fetchall()
        columnas = [desc[0] for desc in cursor.description]

        cursor.close()
        conn.close()

        return render_template_string(
            HTML_TEMPLATE,
            columnas=columnas,
            filas=filas,
            categorias=categorias,
            categoria_seleccionada=categoria
        )
    except Exception as e:
        return f"<h1>Error al obtener datos: {e}</h1>"

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5000)
