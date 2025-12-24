package Tester;

import java.util.ArrayList;
import java.util.List;

/**
 * Representa un examen tipo test con sus características y métodos de cálculo
 */
public class Examen {
    private int preguntasTotales;
    private boolean restaIndirecta;
    private int numRespPosibles;
    private double ratioResta;
    private double notaPaAprobar;
    private List<Integer> numerosMagicos;
    private double puntajeLimite;
    
    /**
     * Constructor del examen
     */
    public Examen(int preguntasTotales, boolean restaIndirecta, int numRespPosibles, 
                  double ratioResta, double notaPaAprobar) {
        this.preguntasTotales = preguntasTotales;
        this.restaIndirecta = restaIndirecta;
        this.numRespPosibles = numRespPosibles;
        this.ratioResta = ratioResta;
        this.notaPaAprobar = notaPaAprobar;
        this.numerosMagicos = new ArrayList<>();
        
        calcularPuntajeLimiteYNumerosMagicos();
    }
    
    /**
     * Calcula el puntaje límite y los números mágicos necesarios para aprobar
     */
    private void calcularPuntajeLimiteYNumerosMagicos() {
        puntajeLimite = (notaPaAprobar / 10) * preguntasTotales;
        
        // Ajuste si el puntaje límite es decimal
        if (puntajeLimite > (int) puntajeLimite) {
            puntajeLimite = (int) puntajeLimite + 1;
        }
        
        // Generar números mágicos
        int i = 0;
        while ((puntajeLimite + i * ratioResta + i) <= preguntasTotales) {
            numerosMagicos.add((int) (puntajeLimite + i * ratioResta + i));
            i++;
        }
    }
    
    /**
     * Calcula aciertos requeridos para aprobar llegando al número mágico
     */
    public int calcularAciertosRequeridos(int pregBien, int metapuntos, int metamagico) {
        int puntosObjetivo = metapuntos - pregBien;
        int pregRestantes = metamagico - pregBien;
        pregRestantes -= puntosObjetivo;
        int aciertosRec = puntosObjetivo;
        
        while (pregRestantes >= ratioResta + 1) {
            pregRestantes -= ratioResta;
            pregRestantes -= 1;
            aciertosRec += 1;
        }
        
        return aciertosRec;
    }
    
    /**
     * Imprime información básica del examen
     */
    public void imprimirInformacion() {
        System.out.println("=== CONFIGURACIÓN DEL EXAMEN ===");
        System.out.println("Número de preguntas: " + preguntasTotales);
        System.out.println("Resta por número de preguntas mal. Cada " + ratioResta + " mal, una bien");
        System.out.println("Nota necesaria para aprobar: " + notaPaAprobar);
        System.out.println("\nNúmeros mágicos para aprobar:");
        for (int magico : numerosMagicos) {
            System.out.println("  - " + magico);
        }
        System.out.println("================================\n");
    }
    
    // Getters
    public int getPreguntasTotales() {
        return preguntasTotales;
    }
    
    public boolean isRestaIndirecta() {
        return restaIndirecta;
    }
    
    public int getNumRespPosibles() {
        return numRespPosibles;
    }
    
    public double getRatioResta() {
        return ratioResta;
    }
    
    public double getNotaPaAprobar() {
        return notaPaAprobar;
    }
    
    public List<Integer> getNumerosMagicos() {
        return new ArrayList<>(numerosMagicos);
    }
    
    public double getPuntajeLimite() {
        return puntajeLimite;
    }
    
    public int getDiffMagicos() {
        if (numerosMagicos.size() < 2) {
            return 0;
        }
        return numerosMagicos.get(1) - numerosMagicos.get(0);
    }
}