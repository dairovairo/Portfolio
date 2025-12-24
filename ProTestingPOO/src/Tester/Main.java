package Tester;

import java.util.Scanner;

/**
 * Clase principal de Protesting - Sistema de estrategia para exámenes tipo test
 * 
 * @author Tu nombre
 * @version 2.0
 */
public class Main {
    
    public static void main(String[] args) {
        long start = System.nanoTime();
        
        // Configuración del examen
        int preguntasTotales = 50;
        boolean restaIndirecta = true;
        int numRespPosibles = 4;
        double ratioResta = 2;
        double notaPaAprobar = 5;
        
        // Crear objeto Examen
        Examen examen = new Examen(
            preguntasTotales,
            restaIndirecta,
            numRespPosibles,
            ratioResta,
            notaPaAprobar
        );
        
        // Mostrar información del examen
        examen.imprimirInformacion();
        
        // Generar y mostrar estrategias
        GeneradorEstrategiaRestaIndirecta generador = new GeneradorEstrategiaRestaIndirecta(examen);
        generador.generarYMostrarEstrategias();
        
        // Corregir examen
        EstimadorNota estimador = new EstimadorNota(examen);
        double arrayOpciones[]=new double [(numRespPosibles-1)];
        double cantidad;
        Scanner sc= new Scanner(System.in);
        int i=0;
        System.out.println("introduce el numero de preguntas que has contestado y tienes seguro bien");
        int preguntasSeguro=sc.nextInt();
        while((i+2)<=numRespPosibles) {
        	System.out.println("introduce el numero de preguntas contestadas en las que tenias "+(i+2)+ " opciones");
        	cantidad=sc.nextDouble();
        	arrayOpciones[i]=cantidad;
        	i++;
        }
        System.out.println(estimador.estimarNotas(preguntasSeguro,arrayOpciones));
        
        // Calcular tiempo de ejecución
        long end = System.nanoTime();
        double elapsedMs = (end - start) / 1_000_000.0;
        System.out.println("\n=== TIEMPO DE EJECUCIÓN ===");
        System.out.println("Tiempo total: " + String.format("%.2f", elapsedMs) + " ms");
        
      
    }
}