import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SearchType {
  USERS = 'users',
  POSTS = 'posts',
  PRODUCTS = 'products',
  COMMUNITIES = 'communities',
  // Alias de posts: ambos buscan en los posts de los foros de las comunidades.
  FORUMS = 'forums',
}

export class SearchQueryDto {
  @ApiProperty({ example: 'pokemon', description: 'Texto a buscar' })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty({ message: 'q es obligatorio' })
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({
    enum: SearchType,
    description:
      'Si se omite, devuelve un resumen con los primeros resultados de cada tipo. forums es alias de posts',
  })
  @IsOptional()
  @IsEnum(SearchType, {
    message: 'type debe ser users, posts, products, communities o forums',
  })
  type?: SearchType;

  @ApiPropertyOptional({
    type: Number,
    default: 1,
    minimum: 1,
    description: 'Solo aplica cuando se pasa type',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    type: Number,
    default: 20,
    minimum: 1,
    maximum: 50,
    description: 'Solo aplica cuando se pasa type',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
