import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CommunityService } from './community.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreateTagDto } from './dto/create-tag.dto';
import { GetTagsQueryDto } from './dto/get-tags-query.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';

interface CommunityFiles {
  image?: Express.Multer.File[];
  banner?: Express.Multer.File[];
}

@ApiTags('community')
@Controller()
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Post('communities')
  @ApiOperation({ summary: 'Crear una comunidad' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    encoding: {
      rules: {
        style: 'form',
        explode: true,
      },
    },
    schema: {
      type: 'object',
      required: [
        'name',
        'description',
        'slug',
        'isPrivate',
        'categoryId',
        'tagIds',
        'rules',
        'image',
        'banner',
      ],
      properties: {
        name: {
          type: 'string',
          example: 'My Little Pony Collectors MX',
        },
        description: {
          type: 'string',
          example: 'Comunidad para coleccionistas...',
        },
        slug: {
          type: 'string',
          example: 'my-little-pony-collectors-mx',
          description: 'Solo minúsculas, números y guiones',
        },
        isPrivate: {
          type: 'boolean',
          example: false,
        },
        categoryId: {
          type: 'integer',
          example: 1,
          minimum: 1,
        },
        tagIds: {
          type: 'array',
          items: { type: 'integer' },
          example: [1, 3],
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        },
        rules: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'No hacer comentarios ofensivos',
            'No hacer spam',
            'Solo temas relacionados a Digimon, y sus derivados',
          ],
          description:
            'Agregue cada regla como un elemento independiente. Las comas dentro de una regla se conservan',
        },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Imagen principal de la comunidad',
        },
        banner: {
          type: 'string',
          format: 'binary',
          description: 'Imagen de portada de la comunidad',
        },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'banner', maxCount: 1 },
    ]),
  )
  create(
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dto: CreateCommunityDto,
    @UploadedFiles() files: CommunityFiles,
  ) {
    return this.communityService.create(
      dto,
      files?.image?.[0],
      files?.banner?.[0],
    );
  }

  @Get('categories')
  @ApiOperation({ summary: 'Consultar las categorías de comunidades' })
  findAllCategories() {
    return this.communityService.findAllCategories();
  }

  @Post('tags')
  @ApiOperation({ summary: 'Crear un tag reutilizable' })
  createTag(@Body() dto: CreateTagDto) {
    return this.communityService.createTag(dto);
  }

  @Get('tags')
  @ApiOperation({ summary: 'Consultar los tags existentes con paginación' })
  @ApiOkResponse({
    schema: {
      example: {
        data: [
          { tagId: 1, name: 'Coleccionismo' },
          { tagId: 2, name: 'Intercambios' },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 2,
          totalPages: 1,
        },
      },
    },
  })
  findAllTags(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: GetTagsQueryDto,
  ) {
    return this.communityService.findAllTags(query);
  }

  @Patch('communities/:id')
  @ApiOperation({ summary: 'Actualizar una comunidad' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: false,
    encoding: {
      rules: {
        style: 'form',
        explode: true,
      },
    },
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          example: 'Nuevo nombre de la comunidad',
        },
        description: {
          type: 'string',
          example: 'Nueva descripción de la comunidad',
        },
        categoryId: {
          type: 'integer',
          example: 2,
          minimum: 1,
        },
        tagIds: {
          type: 'array',
          items: { type: 'integer' },
          example: [1, 3],
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        },
        rules: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'No hacer spam',
            'Mantener el respeto',
            'Se permiten comentarios con comas, sin dividir la regla',
          ],
          description:
            'Agregue cada regla como un elemento independiente. También se acepta un arreglo JSON serializado desde otros clientes',
        },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Nueva imagen principal de la comunidad',
        },
        banner: {
          type: 'string',
          format: 'binary',
          description: 'Nuevo banner de la comunidad',
        },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'banner', maxCount: 1 },
    ]),
  )
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dto: UpdateCommunityDto,
    @UploadedFiles() files: CommunityFiles,
  ) {
    return this.communityService.update(
      id,
      dto,
      files?.image?.[0],
      files?.banner?.[0],
    );
  }

  @Patch('communities/:id/deactivate')
  @ApiOperation({ summary: 'Desactivar una comunidad' })
  @ApiOkResponse({
    schema: { example: { message: 'Comunidad desactivada exitosamente' } },
  })
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.communityService.deactivate(id);
  }

  @Patch('communities/:id/activate')
  @ApiOperation({ summary: 'Activar nuevamente una comunidad' })
  @ApiOkResponse({
    schema: { example: { message: 'Comunidad activada exitosamente' } },
  })
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.communityService.activate(id);
  }

  @Patch('communities/:id/public')
  @ApiOperation({ summary: 'Cambiar una comunidad a pública' })
  @ApiOkResponse({
    schema: {
      example: { message: 'Comunidad configurada como pública exitosamente' },
    },
  })
  makePublic(@Param('id', ParseIntPipe) id: number) {
    return this.communityService.makePublic(id);
  }

  @Patch('communities/:id/private')
  @ApiOperation({ summary: 'Cambiar una comunidad a privada' })
  @ApiOkResponse({
    schema: {
      example: { message: 'Comunidad configurada como privada exitosamente' },
    },
  })
  makePrivate(@Param('id', ParseIntPipe) id: number) {
    return this.communityService.makePrivate(id);
  }
}
