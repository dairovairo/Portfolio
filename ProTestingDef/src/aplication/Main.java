package aplication;

import java.util.Scanner;

import dominio.EstimadorNotaDir;
import dominio.EstimadorNotaIndir;
import dominio.EstimadorNotaSinResta;
import dominio.ExamenRestaDir;
import dominio.ExamenRestaIndir;

public class Main {

    public static void main(String[] args) {

        Scanner sc = new Scanner(System.in);

        int selector = leerIntEnRango(
                sc,
                "¿Qué desea hacer?\n1. Calcular estrategia de resolución\n2. Estimar nota de examen",
                1, 2
        );

        if (selector == 1) {

            int preguntasTotales = leerIntEnRango(
                    sc,
                    "Inserte el número de preguntas totales del examen",
                    10, 100
            );

            int restaIndirecta = leerIntEnRango(
                    sc,
                    "Tipo de resta: Directa -> 1, Indirecta -> 2",
                    1, 2
            );

            int numRespPosibles = leerIntEnRango(
                    sc,
                    "Número de respuestas posibles por pregunta",
                    2, 5
            );

            double ratioResta = leerDoubleEnRango(
                    sc,
                    "Inserte el ratio de resta",
                    1, 4
            );

            double notaPaAprobar = leerDoubleEnRango(
                    sc,
                    "Inserte la nota mínima para aprobar",
                    0, 10
            );

            if (restaIndirecta == 1) {
                ExamenRestaDir examen1 = new ExamenRestaDir(
                        preguntasTotales,
                        restaIndirecta,
                        numRespPosibles,
                        ratioResta,
                        notaPaAprobar
                );
                examen1.ejecutaStrat();

            } else {
                ExamenRestaIndir examen2 = new ExamenRestaIndir(
                        preguntasTotales,
                        restaIndirecta,
                        numRespPosibles,
                        ratioResta,
                        notaPaAprobar
                );
                examen2.ejecutaStrat();
            }

        } else { // selector == 2

            int preguntasTotales = leerIntEnRango(
                    sc,
                    "Inserte el número de preguntas totales del examen",
                    10, 100
            );

            int restaIndirecta = leerIntEnRango(
                    sc,
                    "Tipo de resta: Directa -> 1, Indirecta -> 2, Sin resta -> 0",
                    0, 2
            );

            int numRespPosibles = leerIntEnRango(
                    sc,
                    "Número de respuestas posibles por pregunta",
                    2, 5
            );

            double ratioResta = 0;
            if (restaIndirecta != 0) {
                ratioResta = leerDoubleEnRango(
                        sc,
                        "Inserte el ratio de resta",
                        1, 4
                );
            }

            double notaPaAprobar = 0; // no se usa

            ExamenRestaIndir examen3 = new ExamenRestaIndir(
                    preguntasTotales,
                    restaIndirecta,
                    numRespPosibles,
                    ratioResta,
                    notaPaAprobar
            );

            if (restaIndirecta == 1) {
                EstimadorNotaDir estimador = new EstimadorNotaDir(examen3);
                estimador.ShowResults(estimador);

            } else if (restaIndirecta == 2) {
                EstimadorNotaIndir estimador = new EstimadorNotaIndir(examen3);
                estimador.ShowResults(estimador);

            } else {
                EstimadorNotaSinResta estimador = new EstimadorNotaSinResta(examen3);
                estimador.ShowResults(estimador);
            }
        }

        sc.close();
    }

    // =======================
    // MÉTODOS DE VALIDACIÓN
    // =======================

    private static int leerIntEnRango(Scanner sc, String mensaje, int min, int max) {
        int valor;
        while (true) {
            System.out.println(mensaje + " [" + min + " - " + max + "]");
            if (sc.hasNextInt()) {
                valor = sc.nextInt();
                if (valor >= min && valor <= max) {
                    return valor;
                }
            } else {
                sc.next(); // descarta entrada inválida
            }
            System.out.println("❌ Valor no válido. Inténtelo de nuevo.");
        }
    }

    private static double leerDoubleEnRango(Scanner sc, String mensaje, double min, double max) {
        double valor;
        while (true) {
            System.out.println(mensaje + " [" + min + " - " + max + "]");
            if (sc.hasNextDouble()) {
                valor = sc.nextDouble();
                if (valor >= min && valor <= max) {
                    return valor;
                }
            } else {
                sc.next();
            }
            System.out.println("❌ Valor no válido. Inténtelo de nuevo.");
        }
    }
}
