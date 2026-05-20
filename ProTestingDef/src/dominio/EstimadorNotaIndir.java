package dominio;

public class EstimadorNotaIndir extends EstimadorNota{
	
	 public EstimadorNotaIndir(Examen examen) {
		  super(examen);
	    }
	 @Override
	 public double esperanza (int opciones,int ratio) {                                        
			double puntajeAcierto=(double) (10.0/(double) examen.getPreguntasTotales());       
			                                      
			return (puntajeAcierto/opciones);               
		}
	 
	 public double esperanzaFallos(int opciones) {
		 return (opciones-1)/opciones;
	 }
	 
	 @Override
	 public double estimarAciertos(double arrayOpciones [],int ratio) {        
			double result=0;      
			double resultFallos=0;
		  for(int i=0; i<arrayOpciones.length;i++) {                  
			  result+=arrayOpciones[i]*esperanza(i+2,ratio);
			  resultFallos+=arrayOpciones[i]*esperanzaFallos(i+2);
		  }   
		  int fallosAprox=(int) resultFallos;
		  return (result-(int)(fallosAprox/ratio));                                              		                                                              
		}
	 
                                                                                                 
}
