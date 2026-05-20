package dominio;

public class EstimadorNotaSinResta extends EstimadorNota{
	 public EstimadorNotaSinResta(Examen examen) {
		  super(examen);
	    }
	 @Override
	 public double esperanza (int opciones,int ratio) {
			double puntajeAcierto=(double) (10.0/(double) examen.getPreguntasTotales());
			
			return puntajeAcierto/opciones;
		}
@Override
		public  double estimarAciertos(double arrayOpciones [],int ratio) {
			double result=0;
		  for(int i=0; i<arrayOpciones.length;i++) {
			  result+=arrayOpciones[i]*esperanza(i+2,ratio);

		  }
		 
		  
		  return result;
		  
		}	    

}
