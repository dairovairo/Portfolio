package dominio;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Clase abstracta que representa un examen genérico
 */
public abstract class Examen {
    protected int preguntasTotales;
    protected int restaIndirecta;
    protected int numRespPosibles;
    protected double ratioResta;
    protected double notaPaAprobar;
    protected List<Integer> numerosMagicos;
    protected double puntajeLimite;
    
    /**
     * Constructor del examen
     */
    public Examen(int preguntasTotales, int restaIndirecta, int numRespPosibles, 
                  double ratioResta, double notaPaAprobar) {
        this.preguntasTotales = preguntasTotales;
        this.restaIndirecta = restaIndirecta;
        this.numRespPosibles = numRespPosibles;
        this.ratioResta = ratioResta;
        this.notaPaAprobar = notaPaAprobar;
        this.numerosMagicos = new ArrayList<>();
        
        
       
    }
    
    /**
     * Método abstracto que cada tipo de examen implementará de forma diferente
     */
    protected abstract void calcularPuntajeLimiteYNumerosMagicos();
    
    protected abstract void recorrerSituacion(int j,int diffMagicos);
    
    public void ejecutaStrat() {
    	calcularPuntajeLimiteYNumerosMagicos();
        imprimirInformacion();
        recorrerExamen();
    }
   
	public void recorrerExamen() {
		// TODO Auto-generated method stub
		//evaluacion de respuestas
		System.out.println("paso 1: contesta todo lo que tengas seguro y cuenta el numero de preguntas que tienes bien");
		System.out.println("Si tienes "+puntajeLimite +" preguntas bien, responder hasta "+ (numerosMagicos.get(0)+ratioResta-1)+ " preguntas");
		int diffMagicos=numerosMagicos.get(1)-numerosMagicos.get(0);
	
	    int j=0;	
		while(j<diffMagicos+1) {
			if(j==0) {
			
				System.out.println("Si tienes mas de"+puntajeLimite +"Haz lo que quieras pero se recomienda responder 2 preguntas mas por seguridad");
				j++;	
			}	
		System.out.println("si te falta "+(j) +" preguntas para llegar al primer magico...");
		System.out.println("escogiendo prioritariamente las preguntas en las que dudes entre menos opciones haz lo siguiente:");
		System.out.println("contesta las preguntas que te falten hasta cumplir "+numerosMagicos.get(0)+" respuestas");
		recorrerSituacion(j,diffMagicos);
		j++;
		}
	}
	
	public static void imprimirMapaListas(Map<List<Integer>, Integer> mapa) {
	    if (mapa == null || mapa.isEmpty()) {
	        System.out.println("El mapa está vacío.");
	        return;
	    }

	    int contador = 1;
	    for (Map.Entry<List<Integer>, Integer> entrada : mapa.entrySet()) {
	        System.out.println(contador + ". " + entrada.getKey() + " → Suma: " + entrada.getValue());
	        contador++;
	    }
	    
	}
	
	public static void generarEstados(Map<List<Integer>, Integer> mapa, List<Integer> lista, int index, int minValor, int x) {

	    if (index == lista.size()) {
	        List<Integer> copia = new ArrayList<>(lista);
	        mapa.put(copia, sumarLista(copia));
	        return;
	    }

	    for (int i = minValor; i <= x; i++) {
	        lista.set(index, i);
	        generarEstados(mapa, lista, index + 1, i, x);
	    }
	}
	
	private static int sumarLista(List<Integer> lista) {
	    int sumaTotal = 0;
	    for (int valor : lista) {
	        sumaTotal += valor;
	    }
	    return sumaTotal;
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
    
    public boolean calcuBinom (List <Integer>ListaBinoms,int pregBien,int metaPuntos,int metamagico0,int metamagico1, int ratio, boolean comienzo) {
		boolean result=false;
		int numeroHastaN0=metamagico0-pregBien;
		
		
		List <Integer>ListaBinomsAnt=new ArrayList<>();
		int i=0;
		while(numeroHastaN0>0) {
		ListaBinomsAnt.add(ListaBinoms.get(i));
		numeroHastaN0--;
		i++;
		}
		
		
		if(probAtLeastX(ListaBinoms,calcularAciertosRequeridos(pregBien,metaPuntos,metamagico1))>probAtLeastX(ListaBinomsAnt,calcularAciertosRequeridos(pregBien,metaPuntos,metamagico0))) {
			result=true;
		}
		else {
			
			result=false;
		}
		return result;
	}

    public static double probAtLeastX(List<Integer> G, int x) {
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

    public void calcularHeuristica(Map<Integer, List<Integer>> recta,int ratio, int metamagico1) {
    	if(calcularZ(recta)==-1) {
    		System.out.println("responde si o si");
    	}
    	else {
    double heur=calcularZ(recta)+((ratio+1)*4);
	//aqui ratio+1 no vale, en la ultima iteracion cuando magico1=pregtotales, sera pregtotles-metamafico1
	if(metamagico1==preguntasTotales) {
		heur=calcularZ(recta)+((preguntasTotales-metamagico1)*4);
	  }
	System.out.println(heur);
    	}
    }
    
    public void agregarPuntosDeAnalisis (Map <List<Integer>,Integer> mapa,int pregBien,int metaPuntos,int metamagico0,int metamagico1, int ratio, int opcionesPorPreg, boolean comienzo, int preguntasTotales) {
  		Map<Integer, List<Integer>> recta=new HashMap<>();
  	
  		int numeroHastaN0=metamagico0-pregBien;//pregBien solo es pregBien la primera iteracion, luego es anterior magico
  		
  		int numeroHastaN1=metamagico1-pregBien;
  		
  		
  		 List <Integer> perdidas= new ArrayList<>();//
  		 
  		 List <Integer> evitadas= new ArrayList<>();
  		
  		
  		for (Map.Entry<List<Integer>, Integer> entry : mapa.entrySet()) {
  		    List<Integer> clave = entry.getKey();
  		    Integer valor = entry.getValue();
  		    // dentro del if, solo para debug
  		   
  			  int k=numeroHastaN0;
  			  
  			  int secondHalfSum=0;
  			
  			  while (k<numeroHastaN1) {
  				
  			secondHalfSum+=clave.get(k)*clave.get(k);
  				 
  				  
  			k++;
  			
  			  }
  			 
  		   
  		   if( !calcuBinom(clave,pregBien,metaPuntos,metamagico0,metamagico1,ratio,comienzo)) {
  			  
  			   agregarPunto(recta,secondHalfSum, -1);
  			
  			 evitadas.add(secondHalfSum);
  			
  		   }
  		   else {
  			 agregarPunto(recta,secondHalfSum,1);
  			
  			   perdidas.add(secondHalfSum);
  			 
  				// System.out.println(clave);
  			 
  		   }
  		}
  		//System.out.println(recta);
  		calcularHeuristica(recta, ratio, metamagico1);
  
      }
    //agrega una combinacion positiva o negativa al conjunto para luego al final trazar solucion
    public static void agregarPunto(Map<Integer, List<Integer>> recta, int posicion, int punto) {
        recta.computeIfAbsent(posicion, k -> new ArrayList<>()).add(punto);
    }
    
  //el metodo devuelve responder solo si estrictamente menor que z
  	public static int calcularZ(Map<Integer, List<Integer>> recta) {

          // Totales en toda la recta
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

          double x1 = (double) totalBeneficio / totalPuntos;
          double x2 = (double) totalPerjuicio / totalPuntos;
          double x3 = x1 - x2;

        
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

              double y1 = (double) parcialBeneficio / parcialPuntos;
              double y2 = (double) parcialPerjuicio / parcialPuntos;
              double y3 = y1 - y2;

              if (y3 > mejorY3) {
                  mejorY3 = y3;
                  mejorZ = z + 1; // intervalo [0, z)
              }
          }
         
          return mejorZ;
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
    
    public int isRestaIndirecta() {
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