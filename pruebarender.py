from flask import Flask, render_template_string
import sqlite3

app = Flask(__name__)

DB_PATH = "resultados.db"  # tu archivo SQLite

@app.route("/")
def index():
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tablas = cursor.fetchall()
        conn.close()
    except Exception as e:
        tablas = []
        print("Error al conectar a la base de datos:", e)

    html = """
    <html>
        <head><title>Prueba Render</title></head>
        <body>
            <h1>Servidor Flask en Render</h1>
            <p>Tablas en la base de datos:</p>
            <ul>
                {% for tabla in tablas %}
                    <li>{{ tabla[0] }}</li>
                {% endfor %}
            </ul>
        </body>
    </html>
    """
    return render_template_string(html, tablas=tablas)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
