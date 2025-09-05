
from flask import Flask, render_template_string, request
import pandas as pd
from datetime import datetime

app = Flask(__name__)

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQYfTQDKEyVZwHvJNrsj1_hxACqg-QuKLLR7BcQs3CB5_jg8UBsD1J81x1Km1l2kA/pub?gid=110548680&single=true&output=csv"

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
    margin-bottom: 5px;
}

.last-updated {
    font-size: 14px;
    color: #000;   /* 🔹 ahora en negro */
    margin-bottom: 20px;
    background-color: rgba(255,255,255,0.7); /* 🔹 fondo blanco translúcido */
    display: inline-block;
    padding: 4px 8px;
    border-radius: 5px;
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
    var categ
