package Tester;


import java.util.ArrayList;
import java.util.List;

/**
 * Realiza cálculos probabilísticos para determinar las mejores estrategias
 */
public class AnalizadorProbabilidades {
    
    /**
     * Calcula si conviene responder basándose en probabilidades binomiales
     */
    public boolean calcularBinomial(List<Integer> listaBinoms, int pregBien, 
                                   int metaPuntos, int metamagico0, 
                                   int metamagico1, int ratio, boolean comienzo) {
        
        int numeroHastaN0 = metamagico0 - pregBien;
        
        List<Integer> listaBinomsAnt = new ArrayList<>();
        int i = 0;
        while (numeroHastaN0 > 0) {
            listaBinomsAnt.add(listaBinoms.get(i));
            numeroHastaN0--;
            i++;
        }
        
        int aciertosReq0 = calcularAciertosRequeridos(pregBien, metaPuntos, metamagico0, ratio);
        int aciertosReq1 = calcularAciertosRequeridos(pregBien, metaPuntos, metamagico1, ratio);
        
        double probAnterior = calcularProbAtLeastX(listaBinomsAnt, aciertosReq0);
        double probActual = calcularProbAtLeastX(listaBinoms, aciertosReq1);
        
        return probActual > probAnterior;
    }
    
    /**
     * Calcula la probabilidad de obtener al menos X aciertos
     * Usa programación dinámica para calcular distribuciones binomiales
     */
    public double calcularProbAtLeastX(List<Integer> G, int x) {
        int n = G.size();
        double[] dp = new double[n + 1];
        dp[0] = 1.0;
        
        for (int Gi : G) {
            double p = 1.0 / Gi;
            double q = 1.0 - p;
            
            for (int k = n; k >= 0; k--) {
                double prev = dp[k] * q;
                double add = (k > 0) ? dp[k - 1] * p : 0.0;
                dp[k] = prev + add;
            }
        }
        
        double result = 0.0;
        for (int k = x; k <= n; k++) {
            result += dp[k];
        }
        
        return result;
    }
    
    /**
     * Calcula aciertos requeridos para alcanzar el número mágico
     */
    private int calcularAciertosRequeridos(int pregBien, int metapuntos, 
                                          int metamagico, int ratio) {
        int puntosObjetivo = metapuntos - pregBien;
        int pregRestantes = metamagico - pregBien;
        pregRestantes -= puntosObjetivo;
        int aciertosRec = puntosObjetivo;
        
        while (pregRestantes >= ratio + 1) {
            pregRestantes -= ratio;
            pregRestantes -= 1;
            aciertosRec += 1;
        }
        
        return aciertosRec;
    }
}