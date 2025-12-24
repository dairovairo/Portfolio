package Tester;

import java.util.*;

/**
 * Genera y presenta las estrategias de resolución del examen
 */
public class GeneradorEstrategiaRestaIndirecta {
    private Examen examen;
    private CalcuStratRestIndirect calculadora;
    
    public GeneradorEstrategiaRestaIndirecta(Examen examen) {
        this.examen = examen;
        this.calculadora = new CalcuStratRestIndirect(examen);
    }
    
    /**
     * Genera todas las estrategias para el examen
     */
    public void generarYMostrarEstrategias() {
        System.out.println("=== ESTRATEGIA DE RESOLUCIÓN ===");
        System.out.println("Paso 1: Contesta todo lo que tengas seguro y cuenta el número de preguntas que tienes bien\n");
        
        int diffMagicos = examen.getDiffMagicos();
        int puntajeLimite = (int) examen.getPuntajeLimite();
        List<Integer> numerosMagicos = examen.getNumerosMagicos();
        
        int j = 0;
        while (j < diffMagicos + 1) {
            if (j == 0) {
                mostrarInstruccionesIniciales(puntajeLimite, numerosMagicos);
                j++;
                continue;
            }
            
            System.out.println("\n--- Si te falta " + j + " pregunta(s) para llegar al primer mágico ---");
            System.out.println("Escogiendo prioritariamente las preguntas en las que dudes entre menos opciones:");
            System.out.println("Contesta las preguntas que te falten hasta cumplir " + numerosMagicos.get(0) + " respuestas\n");
            
            procesarEstrategiasPorNivel(j, diffMagicos, puntajeLimite, numerosMagicos);
            j++;
        }
    }
    
    /**
     * Muestra las instrucciones iniciales cuando tienes el puntaje límite
     */
    private void mostrarInstruccionesIniciales(int puntajeLimite, List<Integer> numerosMagicos) {
    	if(examen.isRestaIndirecta()) {
        System.out.println("Si tienes " + puntajeLimite + " preguntas bien:");
        System.out.println("  → puedes responder hasta " + (numerosMagicos.get(0) + examen.getRatioResta() - 1) + " preguntas");
        System.out.println("Si tienes más de " + puntajeLimite + " preguntas bien:");
        System.out.println("  → Haz lo que quieras, pero se recomienda responder 2 preguntas más");
    	}
    	else {
            System.out.println("Si tienes " + puntajeLimite + " preguntas bien puedes plantarte si quieres");
            System.out.println("Si tienes más de " + puntajeLimite + " preguntas bien puedes plantarte si quieres");
            
    	}
    }
    
    /**
     * Procesa las estrategias para cada nivel de preguntas
     */
    private void procesarEstrategiasPorNivel(int j, int diffMagicos, int puntajeLimite, 
                                            List<Integer> numerosMagicos) {
        int k = 0;
        
        while (k < numerosMagicos.size() - 1) {
            int preguntasBien = puntajeLimite - j;
            
            // Generar arrays para análisis
            int tamaño1 = k * diffMagicos + diffMagicos + j;
            Map<List<Integer>, Integer> sumasTotales = calculadora.generarEstados(tamaño1);
            
            System.out.println("Si en las próximas " + diffMagicos + " preguntas");
            System.out.println("sumas el cuadrado de las respuestas posibles en cada una y obtienes menos de:");
            
            calculadora.calcularHeuristicaRespuesta(
                sumasTotales, 
                preguntasBien, 
                puntajeLimite,
                numerosMagicos.get(k), 
                numerosMagicos.get(k + 1)
            );
            
            k++;
            
            // Procesar última iteración si es necesario
            if ((k + 1) == numerosMagicos.size() && 
                numerosMagicos.get(k) != examen.getPreguntasTotales()) {
                procesarUltimaIteracion(preguntasBien, puntajeLimite, numerosMagicos, k);
            }
        }
    }
    
    /**
     * Procesa la última iteración cuando hay preguntas restantes
     */
    private void procesarUltimaIteracion(int preguntasBien, int puntajeLimite,
                                        List<Integer> numerosMagicos, int k) {
        int tamaño2 = examen.getPreguntasTotales() - preguntasBien;
        Map<List<Integer>, Integer> sumasTotales2 = calculadora.generarEstados(tamaño2);
        
        System.out.println("\nSi desde " + numerosMagicos.get(k) + 
                         " hasta " + examen.getPreguntasTotales() + " da menos que:");
        
        calculadora.calcularHeuristicaRespuesta(
            sumasTotales2,
            preguntasBien,
            puntajeLimite,
            numerosMagicos.get(k),
            examen.getPreguntasTotales()
        );
    }
}