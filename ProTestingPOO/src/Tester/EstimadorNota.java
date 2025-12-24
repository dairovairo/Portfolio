package Tester;
import java.util.*;

public class EstimadorNota {
	protected Examen examen;
	 public EstimadorNota(Examen examen) {
	        this.examen = examen;
	    }
	 

public double esperanza (int opciones) {
	double puntajeAcierto=(double) (10.0/(double) examen.getPreguntasTotales());
	
	return puntajeAcierto/opciones;
}

public  double estimarAciertos(double arrayOpciones []) {
	double result=0;
  for(int i=0; i<arrayOpciones.length;i++) {
	  result+=arrayOpciones[i]*esperanza(i+2);

  }
  System.out.println(result);
  
  return result;
  
}	    

public double estimarNotas(int preguntasBien,double arrayOpciones[]) {
double nota=(estimarAciertos(arrayOpciones)+(preguntasBien*10/examen.getPreguntasTotales()));
	return nota;
}

}
