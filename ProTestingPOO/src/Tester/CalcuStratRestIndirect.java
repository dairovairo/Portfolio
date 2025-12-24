package Tester;

import java.util.*;

/**
 * Calcula las estrategias óptimas para resolver un examen tipo test
 */
public class CalcuStratRestIndirect {
    private Examen examen;
    private AnalizadorProbabilidades analizadorProb;
    
    public CalcuStratRestIndirect(Examen examen) {
        this.examen = examen;
        this.analizadorProb = new AnalizadorProbabilidades();
    }
    
    /**
     * Genera todos los estados posibles de respuestas
     */
    public Map<List<Integer>, Integer> generarEstados(int tamaño) {
        Map<List<Integer>, Integer> mapa = new HashMap<>();
        List<Integer> lista = new ArrayList<>();
        
        for (int i = 0; i < tamaño; i++) {
            lista.add(2);
        }
        
        generarEstadosRecursivo(mapa, lista, 0, 2, examen.getNumRespPosibles());
        return mapa;
    }
    
    /**
     * Método recursivo para generar estados
     */
    private void generarEstadosRecursivo(Map<List<Integer>, Integer> mapa, List<Integer> lista,
                                         int index, int minValor, int maxValor) {
        if (index == lista.size()) {
            List<Integer> copia = new ArrayList<>(lista);
            mapa.put(copia, sumarLista(copia));
            return;
        }
        
        for (int i = minValor; i <= maxValor; i++) {
            lista.set(index, i);
            generarEstadosRecursivo(mapa, lista, index + 1, i, maxValor);
        }
    }
    
    /**
     * Suma todos los elementos de una lista
     */
    private int sumarLista(List<Integer> lista) {
        int suma = 0;
        for (int valor : lista) {
            suma += valor;
        }
        return suma;
    }
    
    /**
     * Calcula la heurística de cuándo responder basándose en probabilidades
     */
    public void calcularHeuristicaRespuesta(Map<List<Integer>, Integer> mapa, 
                                            int pregBien, int metaPuntos,
                                            int metamagico0, int metamagico1) {
        
        Map<Integer, List<Integer>> recta = new HashMap<>();
        int numeroHastaN0 = metamagico0 - pregBien;
        int numeroHastaN1 = metamagico1 - pregBien;
        
        List<Integer> perdidas = new ArrayList<>();
        List<Integer> evitadas = new ArrayList<>();
        
        // Analizar cada posible secuencia de respuestas
        for (Map.Entry<List<Integer>, Integer> entry : mapa.entrySet()) {
            List<Integer> clave = entry.getKey();
            
            int k = numeroHastaN0;
            int secondHalfSum = 0;
            
            while (k < numeroHastaN1) {
                secondHalfSum += clave.get(k) * clave.get(k);
                k++;
            }
            
            boolean debeResponder = analizadorProb.calcularBinomial(
                clave, pregBien, metaPuntos, metamagico0, metamagico1, 
                (int) examen.getRatioResta(), true
            );
            
            if (!debeResponder) {
                agregarPunto(recta, secondHalfSum, -1);
                evitadas.add(secondHalfSum);
            } else {
                agregarPunto(recta, secondHalfSum, 1);
                perdidas.add(secondHalfSum);
            }
        }
        
        // Calcular heurística Z
        double heur = calcularZ(recta) + ((examen.getRatioResta() + 1) * 4);
        
        if (metamagico1 == examen.getPreguntasTotales()) {
            heur = calcularZ(recta) + ((examen.getPreguntasTotales() - metamagico1) * 4);
        }
        
        imprimirResultadosAnalisis(recta, perdidas, evitadas, heur);
    }
    
    /**
     * Agrega un punto a la recta de análisis
     */
    private void agregarPunto(Map<Integer, List<Integer>> recta, int posicion, int punto) {
        recta.computeIfAbsent(posicion, k -> new ArrayList<>()).add(punto);
    }
    
    /**
     * Calcula el valor Z óptimo para la estrategia
     */
    private int calcularZ(Map<Integer, List<Integer>> recta) {
        int totalBeneficio = 0;
        int totalPerjuicio = 0;
        int totalPuntos = 0;
        
        for (List<Integer> lista : recta.values()) {
            for (int v : lista) {
                if (v == 1) totalBeneficio++;
                else if (v == -1) totalPerjuicio++;
                totalPuntos++;
            }
        }
        
        if (totalPuntos == 0) return -1;
        
        double x3 = (double) totalBeneficio / totalPuntos - (double) totalPerjuicio / totalPuntos;
        
        List<Integer> claves = new ArrayList<>(recta.keySet());
        Collections.sort(claves);
        
        int parcialBeneficio = 0;
        int parcialPerjuicio = 0;
        int parcialPuntos = 0;
        
        double mejorY3 = x3;
        int mejorZ = -1;
        
        for (int z : claves) {
            List<Integer> lista = recta.get(z);
            for (int v : lista) {
                if (v == 1) parcialBeneficio++;
                else if (v == -1) parcialPerjuicio++;
                parcialPuntos++;
            }
            
            if (parcialPuntos == 0) continue;
            
            double y3 = (double) parcialBeneficio / parcialPuntos - 
                       (double) parcialPerjuicio / parcialPuntos;
            
            if (y3 > mejorY3) {
                mejorY3 = y3;
                mejorZ = z + 1;
            }
        }
        
        return mejorZ;
    }
    
    /**
     * Imprime los resultados del análisis
     */
    private void imprimirResultadosAnalisis(Map<Integer, List<Integer>> recta,
                                           List<Integer> perdidas, List<Integer> evitadas,
                                           double heur) {
        if (calcularZ(recta) == -1) {
            System.out.println("Responde a las preguntas sí o sí");
        } else {
      
            
            System.out.println(heur);
        }
    }
}