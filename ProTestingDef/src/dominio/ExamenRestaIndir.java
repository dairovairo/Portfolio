package dominio;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Examen de tipo Test (tu implementación actual)
 */
public class ExamenRestaIndir extends Examen {
    
    public ExamenRestaIndir(int preguntasTotales, int restaIndirecta, int numRespPosibles, 
                      double ratioResta, double notaPaAprobar) {
        super(preguntasTotales, restaIndirecta, numRespPosibles, ratioResta, notaPaAprobar);
    }
    
    @Override
    protected void calcularPuntajeLimiteYNumerosMagicos() {
        puntajeLimite = (notaPaAprobar / 10.0) * (double) (preguntasTotales);
        
        // Ajuste si el puntaje límite es decimal
        if (puntajeLimite > (int) puntajeLimite) {
            puntajeLimite = (int) puntajeLimite + 1;
        }
        
        // Generar números mágicos
        int i = 0;
        while ((puntajeLimite + i * ratioResta + i+(ratioResta-1)) <= preguntasTotales) {
            numerosMagicos.add((int) (puntajeLimite + i * ratioResta + i+(ratioResta-1)));
            i++;
        }
    }

   

	
	@Override
	protected void recorrerSituacion(int j,int diffMagicos) {
		int k=0;
		int preguntasBien=(int) (puntajeLimite-(j));
		while(k<numerosMagicos.size()-1) {
			List<Integer> arrayNewAns = new ArrayList<>();
			for(int z=0;z<(k*diffMagicos+diffMagicos+j+(diffMagicos-2));z++) {
				arrayNewAns.add(2);
				
			}
			//
			List<Integer> arrayNewAns2 = new ArrayList<>();
			for(int z=0;z<(preguntasTotales-preguntasBien);z++) {
				arrayNewAns2.add(2);
				
			}
			//
			Map <List<Integer>,Integer> sumasTotales= new HashMap <List<Integer>,Integer>();
					generarEstados(sumasTotales,arrayNewAns,0,2,numRespPosibles);
					if(k==0) {
						System.out.println("si en las proximas "+ diffMagicos+ " preguntas");
					}
					else {
					System.out.println("si en las proximas "+ diffMagicos+ " preguntas");
					}
					System.out.println("sumas el cuadrado de las respuestas posibles en cada una y obtienes menos de ");
					agregarPuntosDeAnalisis(sumasTotales,preguntasBien,(int)puntajeLimite,numerosMagicos.get(k),numerosMagicos.get(k+1),(int) ratioResta, numRespPosibles, true,preguntasTotales);//no cambiar
					
k++;
Map <List<Integer>,Integer> sumasTotales2= new HashMap <List<Integer>,Integer>();
if(((k+1)==numerosMagicos.size())&&(numerosMagicos.get(k)!=preguntasTotales)) {
	generarEstados(sumasTotales2,arrayNewAns2,0,2,numRespPosibles);
	System.out.println("si en las ultimas "+(preguntasTotales-numerosMagicos.get(k))+" preguntas obtienes menos de ");
	agregarPuntosDeAnalisis(sumasTotales2,preguntasBien,(int)puntajeLimite,numerosMagicos.get(k),preguntasTotales,(int) ratioResta, numRespPosibles, true,preguntasTotales);//no cambiar
}
		}
	}
}