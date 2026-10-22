import { ApiProperty } from '@nestjs/swagger';

// Tiempo de respuesta de un vendedor (null si la muestra es muy chica).
export class ResponseTimeDto {
  @ApiProperty({
    example: 42,
    description:
      'Mediana, en minutos (redondeada), entre el primer mensaje del comprador y la primera respuesta del vendedor',
  })
  medianMinutes!: number;

  @ApiProperty({
    example: 12,
    description:
      'Conversaciones respondidas cuyo primer mensaje del comprador es de los últimos 90 días',
  })
  sampleSize!: number;
}
