package dominio;
import java.util.*;

public abstract class EstimadorNota {
	protected Examen examen;
	 public EstimadorNota(Examen examen) {
	        this.examen = examen;
	    }
	 protected abstract double esperanza(int opciones,int ratio);
	    
	    protected abstract double estimarAciertos(double arrayOpciones [],int ratio);
	 
public void ShowResults(EstimadorNota estimador) {
	Scanner sc = new Scanner (System.in);
    double arrayOpciones[]=new double [(examen.numRespPosibles-1)];
    double cantidad;
   
    int i=0;
    System.out.println("introduce el numero de preguntas que has contestado y tienes seguro bien");
    int preguntasSeguro=sc.nextInt();
    while((i+2)<=examen.numRespPosibles) {
    	System.out.println("introduce el numero de preguntas contestadas en las que tenias "+(i+2)+ " opciones");
    	cantidad=sc.nextDouble();
    	arrayOpciones[i]=cantidad;
    	i++;
    }
    System.out.println(estimador.estimarNotas(preguntasSeguro,arrayOpciones));
}
	 


    

public double estimarNotas(int preguntasBien,double arrayOpciones[]) {
	double nota=(estimarAciertos(arrayOpciones,(preguntasBien*10/examen.getPreguntasTotales()))); 
	return nota;
}



}