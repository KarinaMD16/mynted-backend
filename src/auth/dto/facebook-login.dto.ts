import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FacebookLoginDto {
  @ApiProperty({
    description: 'Access token entregado por el SDK de Facebook',
  })
  @IsString()
  accessToken!: string;
}
