import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'ID token entregado por Google Identity Services',
  })
  @IsString()
  idToken!: string;
}
